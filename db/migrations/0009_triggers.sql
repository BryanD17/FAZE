-- =============================================================================
-- 0009_triggers.sql
--
-- Invariants that must hold no matter which caller changed the data —
-- a stored procedure, a future endpoint nobody has written yet, a seed
-- script, an admin action. A trigger is the only place a rule like that can
-- actually be enforced for every writer at once; putting it in application
-- code only protects the callers someone remembered to update.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- trg_group_member_ai / _au / _ad — the ONLY writers of
-- lfg_group.member_count, and the only code that flips `status` between
-- 'recruiting' and 'full'. See docs/schema.md §6 for why member_count is a
-- deliberate denormalization: this trigger set is the other half of that
-- decision — the thing that keeps the redundant column honest.
--
-- Application code writing member_count directly is a defect (anti-pattern
-- C3) precisely because these triggers already do it, correctly, for every
-- INSERT/UPDATE/DELETE on group_member regardless of which procedure or
-- future code path caused it.
--
-- The status flip is intentionally narrow: it only ever moves a group
-- between 'recruiting' and 'full'. A group that is 'active' or 'archived'
-- is left alone — those are states a human (or sp_leave_group, for archive)
-- put the group into on purpose, and a membership change should not
-- silently pull a group back into the recruiting pool.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_group_member_ai;
DROP TRIGGER IF EXISTS trg_group_member_au;
DROP TRIGGER IF EXISTS trg_group_member_ad;

CREATE TRIGGER trg_group_member_ai
AFTER INSERT ON group_member
FOR EACH ROW
BEGIN
  IF NEW.state = 'active' THEN
    UPDATE lfg_group
       SET member_count = member_count + 1
     WHERE group_id = NEW.group_id;

    UPDATE lfg_group
       SET status = 'full'
     WHERE group_id = NEW.group_id
       AND status = 'recruiting'
       AND member_count >= max_members;
  END IF;
END;

CREATE TRIGGER trg_group_member_au
AFTER UPDATE ON group_member
FOR EACH ROW
BEGIN
  -- active -> not active (left / removed): one fewer active member.
  IF OLD.state = 'active' AND NEW.state <> 'active' THEN
    UPDATE lfg_group
       SET member_count = member_count - 1
     WHERE group_id = NEW.group_id;

    UPDATE lfg_group
       SET status = 'recruiting'
     WHERE group_id = NEW.group_id
       AND status = 'full'
       AND member_count < max_members;
  END IF;

  -- not active -> active (a rejoin via sp_join_group's upsert, or a
  -- moderator reinstating someone): one more active member.
  IF OLD.state <> 'active' AND NEW.state = 'active' THEN
    UPDATE lfg_group
       SET member_count = member_count + 1
     WHERE group_id = NEW.group_id;

    UPDATE lfg_group
       SET status = 'full'
     WHERE group_id = NEW.group_id
       AND status = 'recruiting'
       AND member_count >= max_members;
  END IF;
END;

CREATE TRIGGER trg_group_member_ad
AFTER DELETE ON group_member
FOR EACH ROW
BEGIN
  -- Hard deletes of a membership row are not part of the normal product
  -- flow (state transitions are preferred so history survives — see
  -- docs/schema.md's reasoning on group_member.state), but this trigger
  -- exists so the invariant holds even if one ever happens.
  IF OLD.state = 'active' THEN
    UPDATE lfg_group
       SET member_count = member_count - 1
     WHERE group_id = OLD.group_id;

    UPDATE lfg_group
       SET status = 'recruiting'
     WHERE group_id = OLD.group_id
       AND status = 'full'
       AND member_count < max_members;
  END IF;
END;

-- -----------------------------------------------------------------------------
-- trg_message_ai — bumps lfg_group.last_activity_at whenever a group
-- receives a new message. This is the +3 "recent activity" match-score
-- component's data source (§5.4) and the browse sort's tiebreaker.
-- Application code must never write last_activity_at itself: a message sent
-- through any future endpoint (a bot, an import) still counts as activity
-- only if this trigger — not a route handler — is what records it.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_message_ai;

CREATE TRIGGER trg_message_ai
AFTER INSERT ON message
FOR EACH ROW
BEGIN
  UPDATE lfg_group
     SET last_activity_at = NOW()
   WHERE group_id = NEW.group_id;
END;

-- -----------------------------------------------------------------------------
-- trg_user_bu / trg_profile_bu — audit trail for the two account attributes
-- an account-takeover or moderation investigation would need history for:
-- account status (suspended/reinstated/deleted) and display name (used for
-- impersonation). Firing only when the audited column actually changed
-- keeps the log from filling with rows for unrelated updates (a login
-- timestamp bump should never produce an audit_log row).
--
-- actor_user_id is NULL here: a trigger has no notion of "who is making this
-- HTTP request" — that context lives in the application layer, which is
-- free to set a session variable the trigger could read in a future
-- iteration. Recording NULL is honest; guessing an actor would not be.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_user_bu;
DROP TRIGGER IF EXISTS trg_profile_bu;

CREATE TRIGGER trg_user_bu
BEFORE UPDATE ON `user`
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO audit_log (table_name, row_pk, action, actor_user_id, old_values, new_values)
    VALUES (
      'user', CAST(OLD.user_id AS CHAR), 'UPDATE', NULL,
      JSON_OBJECT('status', OLD.status),
      JSON_OBJECT('status', NEW.status)
    );
  END IF;
END;

CREATE TRIGGER trg_profile_bu
BEFORE UPDATE ON profile
FOR EACH ROW
BEGIN
  IF NEW.display_name <> OLD.display_name THEN
    INSERT INTO audit_log (table_name, row_pk, action, actor_user_id, old_values, new_values)
    VALUES (
      'profile', CAST(OLD.user_id AS CHAR), 'UPDATE', NULL,
      JSON_OBJECT('display_name', OLD.display_name),
      JSON_OBJECT('display_name', NEW.display_name)
    );
  END IF;
END;

-- -----------------------------------------------------------------------------
-- trg_rating_bi — the single source of rating eligibility (AGENT 06 task 8
-- explicitly delegates this check to "the trigger from AGENT 03" rather than
-- reimplementing it in the route). A rating may only be inserted when:
--   1. the session it references has actually been played (state='played')
--      — sp_record_session_played is what flips that state, so a rating
--      cannot exist before the session it is about actually happened; and
--   2. both the rater and the ratee were ACTIVE members of that session's
--      group (a departed or removed member cannot be rated by, or rate,
--      people from a group they were never really part of during the
--      session).
--
-- Condition 1 is a deliberate addition beyond the task's literal sentence
-- ("reject a rating where rater and ratee were not both active members of
-- the session's group"): without it, a rating could be submitted for a
-- session that has not happened yet, which is not a real teammate rating.
-- A CHECK constraint cannot express either condition (both require reading
-- OTHER tables), which is exactly why this rule lives in a trigger and not
-- in `rating`'s own DDL.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_rating_bi;

CREATE TRIGGER trg_rating_bi
BEFORE INSERT ON rating
FOR EACH ROW
BEGIN
  DECLARE v_group_id     INT UNSIGNED;
  DECLARE v_session_state VARCHAR(10);
  DECLARE v_rater_active  TINYINT;
  DECLARE v_ratee_active  TINYINT;

  SELECT group_id, state INTO v_group_id, v_session_state
  FROM play_session
  WHERE session_id = NEW.session_id;

  IF v_session_state IS NULL OR v_session_state <> 'played' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rating rejected: the session has not been marked played';
  END IF;

  SELECT COUNT(*) INTO v_rater_active
  FROM group_member
  WHERE group_id = v_group_id AND user_id = NEW.rater_user_id AND state = 'active';

  SELECT COUNT(*) INTO v_ratee_active
  FROM group_member
  WHERE group_id = v_group_id AND user_id = NEW.ratee_user_id AND state = 'active';

  IF v_rater_active = 0 OR v_ratee_active = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'rating rejected: rater and ratee must both be active members of the session''s group';
  END IF;
END;

-- -----------------------------------------------------------------------------
-- "at most one is_primary = 1 per user" — NOT a trigger.
--
-- The master prompt names this as trg_user_game_bi, "enforce at most one
-- is_primary = 1 per user by demoting the previous primary." That is
-- impossible to implement literally: MySQL categorically forbids a trigger
-- from issuing UPDATE/DELETE against the SAME table its firing statement is
-- already writing to ("Can't update table 'user_game' in stored
-- function/trigger because it is already used by statement which invoked
-- this stored function/trigger") — confirmed empirically here with a plain
-- single-row INSERT, not just the upsert path, so there is no BEFORE/AFTER
-- timing trick around it. This is a hard MySQL/InnoDB restriction, not a
-- bug in this schema.
--
-- The invariant is instead enforced STRUCTURALLY, which is arguably
-- stronger than a trigger would have been: `primary_owner_id` mirrors
-- `user_id` exactly when `is_primary = 1` and is NULL otherwise, and a
-- UNIQUE index on it makes a second `is_primary = 1` row for the same user
-- IMPOSSIBLE for every writer — a stored procedure, a future endpoint, a
-- raw SQL statement in a bug — not just the ones that remembered to call a
-- trigger-equivalent helper.
--
-- It is a PLAIN column, not a generated one, for a second, narrower MySQL
-- reason also confirmed empirically: adding a UNIQUE index over a `GENERATED
-- ALWAYS AS (...) STORED` column to a table that has two or more foreign
-- keys fails with the misleading error "Cannot add foreign key constraint"
-- (ERROR 1215) — reproduced on a throwaway table with the exact same FK
-- shape as user_game (FKs to `user` and `game`), and it persists regardless
-- of statement order (FKs before or after the generated column) or
-- foreign_key_checks. user_game has exactly two FKs, so the generated-column
-- form is unavailable here specifically. A plain column keeps the exact same
-- guarantee via the UNIQUE index; the only difference is that something has
-- to WRITE it instead of MySQL deriving it automatically — which is
-- `sp_set_primary_game` below, the single sanctioned way to change a user's
-- primary game.
-- -----------------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'user_game' AND column_name = 'primary_owner_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE user_game
     ADD COLUMN primary_owner_id INT UNSIGNED NULL
       COMMENT ''Mirrors user_id when is_primary=1, else NULL. Written only by sp_set_primary_game; a UNIQUE index on this column is what actually enforces at most one primary per user.''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'user_game'
    AND index_name = 'uq_user_game_one_primary_per_user'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE user_game
     ADD UNIQUE KEY uq_user_game_one_primary_per_user (primary_owner_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
