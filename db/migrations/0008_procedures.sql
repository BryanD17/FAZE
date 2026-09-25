-- =============================================================================
-- 0008_procedures.sql
--
-- Multi-step writes as stored procedures, not as a sequence of separate
-- queries from the application. Every procedure here owns its own
-- transaction: it either commits every write it makes, or none of them.
-- Application code calls `CALL sp_x(...)` and reads the OUT params; it never
-- reimplements the logic inside in JavaScript (anti-pattern C1's sibling for
-- procedural logic — see docs/schema.md §7 for the isolation-level reasoning).
--
-- Every procedure declares:
--   DECLARE EXIT HANDLER FOR SQLEXCEPTION
--   BEGIN
--     ROLLBACK;
--     RESIGNAL;
--   END;
-- immediately after its variable declarations. This catches any UNEXPECTED
-- SQL error (a constraint violation, a deadlock) mid-transaction, rolls back
-- everything the procedure had done so far, and RESIGNALs — re-raising the
-- original MySQL error to the caller unchanged, rather than swallowing it or
-- replacing it with a generic message. This is what makes "forced failure
-- leaves no partial rows" true: partial writes are structurally impossible,
-- not just avoided by convention.
--
-- Expected, handled outcomes (a group being full, a user already a member)
-- are NOT exceptions — they are communicated through an OUT parameter after
-- a normal COMMIT, because refusing a join is a successful procedure call
-- that correctly made no membership change, not a database error.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- sp_create_group — insert lfg_group, its platform rows, and the owner's
-- membership as ONE transaction. Partial group creation (a group row with no
-- owner membership, or missing platforms) must be structurally impossible —
-- every other procedure and every query assumes a group's owner is always
-- also its first member.
--
-- p_platform_ids_csv is a comma-separated list of platform_id values (e.g.
-- "1,3"), turned into rows via JSON_TABLE rather than a loop — a set-based
-- INSERT...SELECT is one statement instead of N, and an invalid platform id
-- in the list fails the whole transaction through the FK constraint on
-- group_platform, exercising the exit handler exactly the way the acceptance
-- criteria's "forced failure" test expects.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_create_group;

CREATE PROCEDURE sp_create_group(
  IN  p_owner_user_id    INT UNSIGNED,
  IN  p_game_id          INT UNSIGNED,
  IN  p_title            VARCHAR(120),
  IN  p_description      VARCHAR(1000),
  IN  p_region_id        TINYINT UNSIGNED,
  IN  p_language_id      SMALLINT UNSIGNED,
  IN  p_visibility       VARCHAR(10),   -- 'open' | 'request' | 'invite'
  IN  p_max_members      TINYINT UNSIGNED,
  IN  p_mic_required     BOOLEAN,
  IN  p_min_age          TINYINT UNSIGNED,
  IN  p_rank_floor       TINYINT UNSIGNED,
  IN  p_rank_ceiling     TINYINT UNSIGNED,
  IN  p_platform_ids_csv VARCHAR(255),  -- e.g. "1,3" — platform_id list
  OUT p_group_id         INT UNSIGNED
)
proc: BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  INSERT INTO lfg_group (
    owner_user_id, game_id, title, description, region_id, language_id,
    visibility, max_members, mic_required, min_age, rank_floor, rank_ceiling
  ) VALUES (
    p_owner_user_id, p_game_id, p_title, p_description, p_region_id, p_language_id,
    p_visibility, p_max_members, p_mic_required, p_min_age, p_rank_floor, p_rank_ceiling
  );
  SET p_group_id = LAST_INSERT_ID();

  -- Set-based insert of every platform id in the CSV. JSON_TABLE turns
  -- "1,3" into two rows without a client-side loop; an id that is not a real
  -- platform fails fk_group_platform_platform and the exit handler above
  -- rolls back the lfg_group row this procedure just inserted too.
  INSERT INTO group_platform (group_id, platform_id)
  SELECT p_group_id, jt.platform_id
  FROM JSON_TABLE(
    CONCAT('[', p_platform_ids_csv, ']'),
    '$[*]' COLUMNS (platform_id TINYINT UNSIGNED PATH '$')
  ) AS jt;

  INSERT INTO group_member (group_id, user_id, role, state)
  VALUES (p_group_id, p_owner_user_id, 'owner', 'active');

  COMMIT;
END proc;

-- -----------------------------------------------------------------------------
-- sp_join_group — THE race-condition procedure. `SELECT ... FOR UPDATE`
-- takes an exclusive lock on the group row, so a second concurrent CALL for
-- the same group_id blocks until the first transaction commits or rolls
-- back — then re-reads the COMMITTED member_count, not a stale snapshot.
-- Without this lock, two transactions under REPEATABLE READ could each read
-- "4 of 5 slots taken" from their own consistent snapshot, both conclude
-- there is room, and both insert — anti-pattern C4, a check-then-act race.
-- With the lock, exactly one of them observes the post-commit count and
-- correctly refuses. See docs/schema.md §7 for the full isolation argument.
--
-- Every check below happens AFTER the lock is acquired, in this order:
--   1. group exists                       -> (safety net beyond the six
--                                              required codes)
--   2. ALREADY_MEMBER   (already active)
--   3. REMOVED_PREVIOUSLY (was removed before — never silently re-admitted)
--   4. NEEDS_REQUEST    (visibility is not 'open' — this procedure never
--                        adds a member to a closed group; the join_request
--                        flow in sp_decide_join_request is the only path in)
--   5. FULL              (member_count >= max_members, read under the lock)
--   6. REQUIREMENT_MIC   (mic_required and the user has none)
--   7. REQUIREMENT_AGE   (min_age set and the user's derived age is under it)
--   8. REQUIREMENT_RANK  (rank window set AND the user has a rank_tier for
--                        this game that falls outside it — an UNRANKED user
--                        is never excluded by this check: excluding a
--                        beginner for not having played the game's ranked
--                        mode yet would be the product working against
--                        itself, and AGENT 07 applies the identical rule to
--                        the match score for the same reason)
--   -> JOINED            (insert, commit)
--
-- REQUIREMENT_MIC is not in the master prompt's literal six-code list, but
-- task 2's own sentence ("re-check capacity and every hard requirement (age,
-- mic, rank window, ...)") names mic explicitly as a hard requirement. Adding
-- it as a seventh code is the only way to actually check what the task asks
-- for; it does not remove or rename any of the six required codes, so every
-- acceptance-criterion example for FULL, REQUIREMENT_AGE, REQUIREMENT_RANK,
-- ALREADY_MEMBER, NEEDS_REQUEST and REMOVED_PREVIOUSLY still applies exactly
-- as specified.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_join_group;

CREATE PROCEDURE sp_join_group(
  IN  p_user_id  INT UNSIGNED,
  IN  p_group_id INT UNSIGNED,
  OUT p_result   VARCHAR(30)
)
proc: BEGIN
  DECLARE v_max_members   TINYINT UNSIGNED;
  DECLARE v_member_count  TINYINT UNSIGNED;
  DECLARE v_visibility    VARCHAR(10);
  DECLARE v_mic_required  BOOLEAN;
  DECLARE v_min_age       TINYINT UNSIGNED;
  DECLARE v_rank_floor    TINYINT UNSIGNED;
  DECLARE v_rank_ceiling  TINYINT UNSIGNED;
  DECLARE v_group_game_id INT UNSIGNED;
  DECLARE v_existing_state VARCHAR(10);
  DECLARE v_user_mic      BOOLEAN;
  DECLARE v_birth_year    SMALLINT UNSIGNED;
  DECLARE v_rank_tier     TINYINT UNSIGNED;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT max_members, member_count, visibility, mic_required, min_age,
         rank_floor, rank_ceiling, game_id
    INTO v_max_members, v_member_count, v_visibility, v_mic_required, v_min_age,
         v_rank_floor, v_rank_ceiling, v_group_game_id
  FROM lfg_group
  WHERE group_id = p_group_id
  FOR UPDATE;

  IF v_max_members IS NULL THEN
    SET p_result = 'NOT_FOUND';
    COMMIT;
    LEAVE proc;
  END IF;

  SELECT state INTO v_existing_state
  FROM group_member
  WHERE group_id = p_group_id AND user_id = p_user_id
  LIMIT 1;

  IF v_existing_state = 'active' THEN
    SET p_result = 'ALREADY_MEMBER';
    COMMIT;
    LEAVE proc;
  END IF;

  IF v_existing_state = 'removed' THEN
    SET p_result = 'REMOVED_PREVIOUSLY';
    COMMIT;
    LEAVE proc;
  END IF;

  IF v_visibility <> 'open' THEN
    SET p_result = 'NEEDS_REQUEST';
    COMMIT;
    LEAVE proc;
  END IF;

  IF v_member_count >= v_max_members THEN
    SET p_result = 'FULL';
    COMMIT;
    LEAVE proc;
  END IF;

  IF v_mic_required = 1 THEN
    SELECT mic_available INTO v_user_mic FROM profile WHERE user_id = p_user_id;
    IF v_user_mic IS NULL OR v_user_mic = 0 THEN
      SET p_result = 'REQUIREMENT_MIC';
      COMMIT;
      LEAVE proc;
    END IF;
  END IF;

  IF v_min_age IS NOT NULL THEN
    SELECT birth_year INTO v_birth_year FROM profile WHERE user_id = p_user_id;
    IF v_birth_year IS NOT NULL AND (YEAR(CURDATE()) - v_birth_year) < v_min_age THEN
      SET p_result = 'REQUIREMENT_AGE';
      COMMIT;
      LEAVE proc;
    END IF;
  END IF;

  IF v_rank_floor IS NOT NULL OR v_rank_ceiling IS NOT NULL THEN
    SELECT rank_tier INTO v_rank_tier
    FROM user_game
    WHERE user_id = p_user_id AND game_id = v_group_game_id;

    -- An unranked user (no user_game row, or rank_tier IS NULL) is never
    -- excluded — see the header comment.
    IF v_rank_tier IS NOT NULL THEN
      IF (v_rank_floor IS NOT NULL AND v_rank_tier < v_rank_floor)
         OR (v_rank_ceiling IS NOT NULL AND v_rank_tier > v_rank_ceiling) THEN
        SET p_result = 'REQUIREMENT_RANK';
        COMMIT;
        LEAVE proc;
      END IF;
    END IF;
  END IF;

  -- Every requirement passed. If v_existing_state = 'left', this INSERT
  -- would collide with the composite PK (group_id, user_id) — use an upsert
  -- so a user who left and now rejoins gets their row reactivated rather
  -- than needing special-case handling here.
  INSERT INTO group_member (group_id, user_id, role, state)
  VALUES (p_group_id, p_user_id, 'member', 'active')
  ON DUPLICATE KEY UPDATE role = 'member', state = 'active', left_at = NULL;

  SET p_result = 'JOINED';
  COMMIT;
END proc;

-- -----------------------------------------------------------------------------
-- sp_decide_join_request — approve or deny a pending request. Authorization
-- (decider must be an active owner/moderator of the group) and the state
-- transition happen inside the same lock and the same transaction as the
-- resulting membership insert, so an approval can never be recorded without
-- the member actually being added, and a race between two moderators
-- deciding the same request resolves to exactly one outcome.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_decide_join_request;

CREATE PROCEDURE sp_decide_join_request(
  IN  p_request_id        INT UNSIGNED,
  IN  p_decider_user_id   INT UNSIGNED,
  IN  p_approve           BOOLEAN,
  OUT p_result            VARCHAR(30)
)
proc: BEGIN
  DECLARE v_group_id     INT UNSIGNED;
  DECLARE v_user_id      INT UNSIGNED;
  DECLARE v_state        VARCHAR(10);
  DECLARE v_decider_role VARCHAR(10);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT group_id, user_id, state INTO v_group_id, v_user_id, v_state
  FROM join_request
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF v_group_id IS NULL THEN
    SET p_result = 'NOT_FOUND';
    COMMIT;
    LEAVE proc;
  END IF;

  IF v_state <> 'pending' THEN
    SET p_result = 'ALREADY_DECIDED';
    COMMIT;
    LEAVE proc;
  END IF;

  SELECT role INTO v_decider_role
  FROM group_member
  WHERE group_id = v_group_id AND user_id = p_decider_user_id AND state = 'active';

  IF v_decider_role IS NULL OR v_decider_role NOT IN ('owner', 'moderator') THEN
    SET p_result = 'UNAUTHORIZED';
    COMMIT;
    LEAVE proc;
  END IF;

  IF p_approve THEN
    -- Re-check capacity under lock: the group could have filled between the
    -- request being made and the moderator deciding it.
    IF (SELECT member_count FROM lfg_group WHERE group_id = v_group_id FOR UPDATE)
       >= (SELECT max_members FROM lfg_group WHERE group_id = v_group_id) THEN
      UPDATE join_request
        SET state = 'denied', decided_by_user_id = p_decider_user_id, decided_at = NOW()
      WHERE request_id = p_request_id;
      SET p_result = 'FULL';
      COMMIT;
      LEAVE proc;
    END IF;

    UPDATE join_request
      SET state = 'approved', decided_by_user_id = p_decider_user_id, decided_at = NOW()
    WHERE request_id = p_request_id;

    INSERT INTO group_member (group_id, user_id, role, state)
    VALUES (v_group_id, v_user_id, 'member', 'active')
    ON DUPLICATE KEY UPDATE role = 'member', state = 'active', left_at = NULL;

    SET p_result = 'APPROVED';
  ELSE
    UPDATE join_request
      SET state = 'denied', decided_by_user_id = p_decider_user_id, decided_at = NOW()
    WHERE request_id = p_request_id;
    SET p_result = 'DENIED';
  END IF;

  COMMIT;
END proc;

-- -----------------------------------------------------------------------------
-- sp_leave_group — sets state='left' and, if the leaver was the OWNER,
-- promotes a successor in the documented order: the longest-tenured active
-- MODERATOR, else the longest-tenured active plain MEMBER, else — if the
-- leaver was the group's only active member — the group is archived rather
-- than left ownerless. A group must never end up with zero owners while it
-- still has members; this procedure is the only place that invariant is
-- enforced, under the same row lock sp_join_group uses so a leave and a
-- concurrent join cannot interleave into an inconsistent state.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_leave_group;

CREATE PROCEDURE sp_leave_group(
  IN  p_user_id  INT UNSIGNED,
  IN  p_group_id INT UNSIGNED,
  OUT p_result   VARCHAR(30)
)
proc: BEGIN
  DECLARE v_role          VARCHAR(10);
  DECLARE v_state         VARCHAR(10);
  DECLARE v_successor_id  INT UNSIGNED;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  -- Lock the group row for the duration of the succession decision.
  SELECT 1 FROM lfg_group WHERE group_id = p_group_id FOR UPDATE;

  SELECT role, state INTO v_role, v_state
  FROM group_member
  WHERE group_id = p_group_id AND user_id = p_user_id
  FOR UPDATE;

  IF v_state IS NULL OR v_state <> 'active' THEN
    SET p_result = 'NOT_A_MEMBER';
    COMMIT;
    LEAVE proc;
  END IF;

  UPDATE group_member
    SET state = 'left', left_at = NOW()
  WHERE group_id = p_group_id AND user_id = p_user_id;

  IF v_role <> 'owner' THEN
    SET p_result = 'LEFT_MEMBER_REMAINS';
    COMMIT;
    LEAVE proc;
  END IF;

  -- The leaver was the owner. Longest-tenured active moderator first.
  SELECT user_id INTO v_successor_id
  FROM group_member
  WHERE group_id = p_group_id AND state = 'active' AND role = 'moderator'
  ORDER BY joined_at ASC
  LIMIT 1;

  IF v_successor_id IS NULL THEN
    -- No moderator: longest-tenured active plain member.
    SELECT user_id INTO v_successor_id
    FROM group_member
    WHERE group_id = p_group_id AND state = 'active' AND role = 'member'
    ORDER BY joined_at ASC
    LIMIT 1;
  END IF;

  IF v_successor_id IS NOT NULL THEN
    UPDATE group_member SET role = 'owner'
    WHERE group_id = p_group_id AND user_id = v_successor_id;
    UPDATE lfg_group SET owner_user_id = v_successor_id WHERE group_id = p_group_id;
    SET p_result = 'LEFT_SUCCESSOR_PROMOTED';
  ELSE
    -- No one left active in the group: archive it rather than orphan it.
    UPDATE lfg_group SET status = 'archived' WHERE group_id = p_group_id;
    SET p_result = 'LEFT_GROUP_ARCHIVED';
  END IF;

  COMMIT;
END proc;

-- -----------------------------------------------------------------------------
-- sp_record_session_played — marks a session played, bumps the group's
-- activity timestamp (a session being played is exactly the kind of real
-- activity last_activity_at exists to reflect), and returns the eligible
-- rater/ratee pairs as a result set.
--
-- It deliberately does NOT pre-insert empty `rating` rows: rating.score is
-- NOT NULL (a rating without a score is not a rating), so there is no valid
-- "open, unscored" row this schema can represent, and inventing one would
-- mean either a fake score (R3 — no placeholder data) or a schema change
-- this agent was not asked to make. Instead, this procedure "opens" the
-- rating window by (a) flipping the session to 'played', which
-- trg_rating_bi (0009) requires before it accepts any rating INSERT for this
-- session, and (b) handing the caller the exact list of who is now eligible
-- to rate whom, so the API can render a "rate your teammates" prompt without
-- a second query.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_record_session_played;

CREATE PROCEDURE sp_record_session_played(
  IN p_session_id INT UNSIGNED
)
proc: BEGIN
  DECLARE v_group_id INT UNSIGNED;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT group_id INTO v_group_id
  FROM play_session
  WHERE session_id = p_session_id
  FOR UPDATE;

  IF v_group_id IS NULL THEN
    ROLLBACK;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'session not found';
  END IF;

  UPDATE play_session SET state = 'played' WHERE session_id = p_session_id;
  UPDATE lfg_group SET last_activity_at = NOW() WHERE group_id = v_group_id;

  COMMIT;

  -- Eligible pairs: every ordered (rater, ratee) combination of the group's
  -- currently active members, excluding self-pairs. A result set, not a
  -- table write — see the header comment.
  SELECT a.user_id AS rater_user_id, b.user_id AS ratee_user_id
  FROM group_member a
  JOIN group_member b
    ON b.group_id = a.group_id AND b.user_id <> a.user_id AND b.state = 'active'
  WHERE a.group_id = v_group_id AND a.state = 'active';
END proc;

-- -----------------------------------------------------------------------------
-- sp_set_primary_game — the ONE sanctioned way to change which game in a
-- user's library is their primary. It exists because MySQL will not allow a
-- trigger to do this (see the long comment in 0009_triggers.sql for why
-- trg_user_game_bi/bu, as the master prompt names them, are impossible): a
-- trigger cannot UPDATE the table its own firing statement is already
-- writing to. A stored procedure has no such restriction — its statements
-- are top-level, not trigger-invoked — so the demote-then-promote sequence
-- that "enforce at most one is_primary per user by demoting the previous
-- primary" actually asks for lives here instead.
--
-- The uq_user_game_one_primary_per_user UNIQUE index (0009) is the REAL,
-- unconditional guarantee — it holds even if this procedure is bypassed by a
-- bug or a future raw query. This procedure is the well-behaved path that
-- keeps `primary_owner_id` in sync with `is_primary` as it makes the change,
-- and reports a clear result instead of a raw duplicate-key error.
--
-- Demote-then-promote in one transaction: if the promote step affects zero
-- rows (no user_game row exists for this user+game — the user has not added
-- this game to their library yet), the demotion is rolled back too, so a
-- failed "set primary" call never leaves the user with NO primary game.
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_set_primary_game;

CREATE PROCEDURE sp_set_primary_game(
  IN  p_user_id INT UNSIGNED,
  IN  p_game_id INT UNSIGNED,
  OUT p_result  VARCHAR(30)
)
proc: BEGIN
  DECLARE v_rows_promoted INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  UPDATE user_game
     SET is_primary = 0, primary_owner_id = NULL
   WHERE user_id = p_user_id AND is_primary = 1 AND game_id <> p_game_id;

  UPDATE user_game
     SET is_primary = 1, primary_owner_id = p_user_id
   WHERE user_id = p_user_id AND game_id = p_game_id;
  SET v_rows_promoted = ROW_COUNT();

  IF v_rows_promoted = 0 THEN
    ROLLBACK;
    SET p_result = 'NOT_FOUND';
  ELSE
    COMMIT;
    SET p_result = 'PRIMARY_SET';
  END IF;
END proc;
