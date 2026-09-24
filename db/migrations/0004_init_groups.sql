-- =============================================================================
-- 0004_init_groups.sql
--
-- Groups: an LFG posting that becomes a persistent group. This is the second
-- half of the data model and the target of every matchmaking query.
--
-- The one intentional denormalization in the whole schema lives here
-- (lfg_group.member_count) and is defended below and in docs/schema.md.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lfg_group (
  group_id      INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  owner_user_id INT UNSIGNED      NOT NULL,
  game_id       INT UNSIGNED      NOT NULL,
  title         VARCHAR(120)      NOT NULL,
  description   VARCHAR(1000)     NULL,
  region_id     TINYINT UNSIGNED  NULL,
  language_id   SMALLINT UNSIGNED NULL,

  visibility ENUM('open','request','invite') NOT NULL DEFAULT 'open'
    COMMENT 'open = join directly; request = needs approval; invite = hidden.',
  status     ENUM('recruiting','full','active','archived') NOT NULL DEFAULT 'recruiting'
    COMMENT 'Maintained alongside member_count by trg_group_member_* in 0009.',

  max_members  TINYINT UNSIGNED NOT NULL,

  -- ---------------------------------------------------------------------------
  -- THE DELIBERATE DENORMALIZATION.
  --
  -- member_count duplicates COUNT(*) over group_member WHERE state='active'.
  -- It exists because the browse and matchmaking queries filter and score on
  -- open slots for EVERY candidate group; computing that aggregate per
  -- candidate on the hot path turns an index range scan into an aggregate over
  -- hundreds of thousands of membership rows.
  --
  -- We pay for it three ways, deliberately:
  --   1. Triggers (0009) are the ONLY writers. Application code writing this
  --      column is a review rejection (anti-pattern C3).
  --   2. v_member_count_reconciliation (0007) exposes the drift between this
  --      value and the true count, and must always return zero rows.
  --   3. The fuzz test in AGENT 15 hammers join/leave/remove and asserts the
  --      drift stays zero.
  -- ---------------------------------------------------------------------------
  member_count TINYINT UNSIGNED NOT NULL DEFAULT 0,

  mic_required BOOLEAN          NOT NULL DEFAULT 0,
  min_age      TINYINT UNSIGNED NULL
    COMMENT 'Hard requirement: a user below this is EXCLUDED, not penalized.',
  rank_floor   TINYINT UNSIGNED NULL,
  rank_ceiling TINYINT UNSIGNED NULL,

  -- Denormalized for the +3 "recent activity" score component and the browse
  -- sort. Written by trg_message_ai and the membership triggers, never by JS.
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id),
  KEY idx_lfg_group_owner (owner_user_id),
  -- The browse/matchmaking access path: filter by game, then status, then
  -- region, ordered by recency. Refined with EXPLAIN evidence in AGENT 16.
  KEY idx_lfg_group_recruit (game_id, status, region_id, last_activity_at),

  -- CASCADE: deleting an account removes the groups it owns. sp_leave_group
  -- promotes a successor when an owner LEAVES, so a group only dies with its
  -- owner when the account itself is destroyed.
  CONSTRAINT fk_lfg_group_owner
    FOREIGN KEY (owner_user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- RESTRICT: a game with live groups must not disappear from the catalog.
  -- An ETL that wants to remove it has to deal with the groups first.
  CONSTRAINT fk_lfg_group_game
    FOREIGN KEY (game_id) REFERENCES game (game_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_lfg_group_region
    FOREIGN KEY (region_id) REFERENCES region (region_id)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_lfg_group_language
    FOREIGN KEY (language_id) REFERENCES `language` (language_id)
    ON DELETE SET NULL ON UPDATE RESTRICT,

  CONSTRAINT ck_lfg_group_max_members CHECK (max_members BETWEEN 2 AND 50),
  CONSTRAINT ck_lfg_group_rank_window
    CHECK (rank_floor IS NULL OR rank_ceiling IS NULL OR rank_floor <= rank_ceiling),
  CONSTRAINT ck_lfg_group_rank_floor
    CHECK (rank_floor IS NULL OR rank_floor BETWEEN 1 AND 10),
  CONSTRAINT ck_lfg_group_rank_ceiling
    CHECK (rank_ceiling IS NULL OR rank_ceiling BETWEEN 1 AND 10),
  -- Cannot structurally prevent member_count > max_members here (a CHECK
  -- across two columns is allowed, but capacity is enforced under a row lock
  -- in sp_join_group where the race actually lives). This CHECK is the backstop.
  CONSTRAINT ck_lfg_group_member_count CHECK (member_count <= max_members)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='An LFG posting that becomes a persistent group.';

-- -----------------------------------------------------------------------------
-- group_platform — which platforms this group plays on. Intersected against
-- user_platform for the +15 platform-overlap component.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_platform (
  group_id    INT UNSIGNED     NOT NULL,
  platform_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (group_id, platform_id),
  KEY idx_group_platform_platform (platform_id),
  CONSTRAINT fk_group_platform_group
    FOREIGN KEY (group_id) REFERENCES lfg_group (group_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_group_platform_platform
    FOREIGN KEY (platform_id) REFERENCES platform (platform_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='M:N group <-> platform.';

-- -----------------------------------------------------------------------------
-- group_member — M:N user <-> group with role and lifecycle state.
--
-- `state` is kept rather than deleting the row, for two reasons the product
-- depends on: the match score subtracts 10 for a group the user previously
-- left, and excludes entirely a group they were removed from. A deleted row
-- cannot express either.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_member (
  group_id  INT UNSIGNED NOT NULL,
  user_id   INT UNSIGNED NOT NULL,
  role      ENUM('owner','moderator','member') NOT NULL DEFAULT 'member',
  state     ENUM('active','left','removed')    NOT NULL DEFAULT 'active',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at   DATETIME NULL,
  PRIMARY KEY (group_id, user_id),
  -- Serves GET /api/me/groups: "this user's active groups".
  KEY idx_group_member_user_state (user_id, state),
  -- Serves owner succession in sp_leave_group: longest-tenured active member.
  KEY idx_group_member_group_state_joined (group_id, state, joined_at),
  CONSTRAINT fk_group_member_group
    FOREIGN KEY (group_id) REFERENCES lfg_group (group_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_group_member_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- An active membership cannot have a departure time, and a departed one must
  -- have it. Without this, "left" rows with a NULL left_at would silently
  -- corrupt any tenure or churn reporting.
  CONSTRAINT ck_group_member_left_at
    CHECK ((state = 'active' AND left_at IS NULL)
           OR (state <> 'active' AND left_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='M:N user <-> group with role and lifecycle state.';

-- -----------------------------------------------------------------------------
-- join_request — a request to join a `request`-visibility group.
--
-- The UNIQUE on (group_id, user_id, state) is subtle and deliberate: it stops a
-- user stacking multiple PENDING requests at the same group (spam), while still
-- allowing the history of one denied and one later approved request to coexist.
-- A UNIQUE on (group_id, user_id) alone would make re-applying after a denial
-- impossible.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS join_request (
  request_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id            INT UNSIGNED NOT NULL,
  user_id             INT UNSIGNED NOT NULL,
  message             VARCHAR(500) NULL,
  state               ENUM('pending','approved','denied','withdrawn') NOT NULL DEFAULT 'pending',
  decided_by_user_id  INT UNSIGNED NULL,
  decided_at          DATETIME     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id),
  UNIQUE KEY uq_join_request_group_user_state (group_id, user_id, state),
  -- Serves the owner's pending-requests queue on the group detail screen.
  KEY idx_join_request_group_state (group_id, state),
  KEY idx_join_request_user (user_id),
  KEY idx_join_request_decider (decided_by_user_id),
  CONSTRAINT fk_join_request_group
    FOREIGN KEY (group_id) REFERENCES lfg_group (group_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_join_request_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- SET NULL: if the moderator who decided a request deletes their account, the
  -- decision itself still happened and the record should survive, minus the
  -- attribution.
  CONSTRAINT fk_join_request_decider
    FOREIGN KEY (decided_by_user_id) REFERENCES `user` (user_id)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  -- A decided request must record when; a pending one must not pretend to have.
  CONSTRAINT ck_join_request_decided_at
    CHECK ((state = 'pending' AND decided_at IS NULL)
           OR (state <> 'pending' AND decided_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Requests to join a closed group, with the moderator decision.';

-- -----------------------------------------------------------------------------
-- play_session — a scheduled play session. Powers the countdown on the
-- dashboard, the .ics export, and the rating flow once a session is played.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS play_session (
  session_id       INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  group_id         INT UNSIGNED      NOT NULL,
  starts_at        DATETIME          NOT NULL COMMENT 'UTC. Rendered in the viewer''s zone.',
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  recurrence       ENUM('none','weekly') NOT NULL DEFAULT 'none',
  state            ENUM('scheduled','played','cancelled') NOT NULL DEFAULT 'scheduled',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id),
  -- Serves "the next upcoming session for this group", read on every group
  -- card and every dashboard row.
  KEY idx_play_session_group_starts (group_id, state, starts_at),
  CONSTRAINT fk_play_session_group
    FOREIGN KEY (group_id) REFERENCES lfg_group (group_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- A zero-minute session is a data-entry error; 24h is a generous ceiling that
  -- still catches a units mix-up (minutes entered as seconds).
  CONSTRAINT ck_play_session_duration CHECK (duration_minutes BETWEEN 15 AND 1440)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Scheduled play sessions for a group.';
