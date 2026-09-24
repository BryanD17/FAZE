-- =============================================================================
-- 0003_init_users.sql
--
-- Identity and the gamer profile. The split between `user` and `profile` is
-- the most deliberate decision in this file and is defended in docs/schema.md:
-- authentication data and public profile data have different access patterns
-- (one is read on every request, the other on profile views), different
-- sensitivity (a leaked password hash is a breach; a leaked display name is a
-- feature), and different lifetimes. Keeping them in one table would mean
-- every profile read pulls the password hash into memory.
--
-- Everything in `profile` and the tables below it exists because §5.4 scores
-- it. A profile in FAZE is the input vector to the matchmaking query.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `user` (
  user_id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email             VARCHAR(255) NOT NULL,
  password_hash     VARCHAR(255) NOT NULL
    COMMENT 'argon2id. 255 chars leaves room for a future parameter change.',
  status            ENUM('pending','active','suspended','deleted') NOT NULL DEFAULT 'pending'
    COMMENT 'ENUM, not a lookup table: a closed set the application branches on.',
  email_verified_at DATETIME     NULL,
  last_login_at     DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  -- Serves the login lookup, and structurally prevents two accounts sharing an
  -- address. The application lowercases before writing so uniqueness is not
  -- left to collation behaviour.
  UNIQUE KEY uq_user_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Authentication identity. Public-facing attributes live in profile.';

-- -----------------------------------------------------------------------------
-- profile — 1:1 with user, sharing user_id as both PK and FK. That shared key
-- is what makes it 1:1 rather than 1:N: there is no separate profile_id that
-- could be duplicated for one user.
--
-- ON DELETE CASCADE: a profile without its account is meaningless.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile (
  user_id       INT UNSIGNED      NOT NULL,
  display_name  VARCHAR(40)       NOT NULL,
  bio           VARCHAR(500)      NULL,
  avatar_url    VARCHAR(500)      NULL,

  -- Birth year rather than a full date of birth: the product only needs an age
  -- bracket for the min_age group requirement, and collecting the precise date
  -- would be gathering more personal data than the feature justifies.
  birth_year    SMALLINT UNSIGNED NULL,

  region_id     TINYINT UNSIGNED  NULL,
  language_id   SMALLINT UNSIGNED NULL,

  -- IANA zone name, validated against Intl.supportedValuesOf at the API layer.
  -- Availability is stored in UTC minutes; this is what converts back for
  -- display, and what a DST-aware conversion needs.
  timezone      VARCHAR(64)       NOT NULL DEFAULT 'UTC',
  mic_available BOOLEAN           NOT NULL DEFAULT 1,

  created_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_profile_display_name (display_name),
  KEY idx_profile_region (region_id),
  CONSTRAINT fk_profile_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- SET NULL, not CASCADE: if a region were ever retired, the person still
  -- exists and should keep their account. They lose a match component until
  -- they pick a new region, which is recoverable; losing the profile is not.
  CONSTRAINT fk_profile_region
    FOREIGN KEY (region_id) REFERENCES region (region_id)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_profile_language
    FOREIGN KEY (language_id) REFERENCES `language` (language_id)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  -- 1940-2020 bounds a plausible living player and rejects typos like 19999 or
  -- a year in the future, which would silently pass a min_age requirement.
  CONSTRAINT ck_profile_birth_year
    CHECK (birth_year IS NULL OR birth_year BETWEEN 1940 AND 2020)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Public gamer profile, 1:1 with user via a shared primary key.';

-- -----------------------------------------------------------------------------
-- user_platform — M:N. Worth +15 when a user's platforms intersect a group's.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_platform (
  user_id     INT UNSIGNED     NOT NULL,
  platform_id TINYINT UNSIGNED NOT NULL,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, platform_id),
  KEY idx_user_platform_platform (platform_id),
  CONSTRAINT fk_user_platform_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_user_platform_platform
    FOREIGN KEY (platform_id) REFERENCES platform (platform_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='M:N user <-> platform. Drives the +15 platform-overlap score.';

-- -----------------------------------------------------------------------------
-- user_tag — M:N. 5 points per shared playstyle tag, capped at 10.
-- The API caps a user at 5 tags; that is a product rule that may change, so it
-- lives in the service layer rather than as a constraint here.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_tag (
  user_id    INT UNSIGNED      NOT NULL,
  tag_id     SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tag_id),
  KEY idx_user_tag_tag (tag_id),
  CONSTRAINT fk_user_tag_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_user_tag_tag
    FOREIGN KEY (tag_id) REFERENCES playstyle_tag (tag_id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='M:N user <-> playstyle_tag.';

-- -----------------------------------------------------------------------------
-- user_game — the user's library. M:N with attributes, which is why it is a
-- table with its own columns rather than a bare join: rank, hours and goal are
-- properties of the RELATIONSHIP between a user and a game, not of either one
-- alone. This is the textbook case for an associative entity.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_game (
  user_id      INT UNSIGNED     NOT NULL,
  game_id      INT UNSIGNED     NOT NULL,

  -- The game's own rank name, free text because every game names ranks
  -- differently ("Gold 3", "Diamond", "Ascendant", "3200 MMR").
  self_rank    VARCHAR(40)      NULL,
  -- The normalized 1-10 tier that makes ranks comparable ACROSS games, which
  -- is what the group rank window filters on. Free text cannot be compared;
  -- this can.
  rank_tier    TINYINT UNSIGNED NULL,

  hours_played SMALLINT UNSIGNED NULL
    COMMENT 'Self-reported. SMALLINT caps at 65535 hours, which is plenty.',
  goal         ENUM('casual','ranked','learning','completionist','content')
               NOT NULL DEFAULT 'casual',
  is_primary   BOOLEAN          NOT NULL DEFAULT 0
    COMMENT 'At most one per user; enforced by trg_user_game_bi in 0009.',
  added_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, game_id),
  -- Serves the reverse-match query ("which users fit this group"), which
  -- filters by game and then by rank window: GET /api/groups/:id/candidates.
  KEY idx_user_game_game_rank (game_id, rank_tier),
  CONSTRAINT fk_user_game_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- RESTRICT: a game with players in their libraries must not vanish from the
  -- catalog under them. An ETL re-run that wants to remove a game has to
  -- reckon with the people who play it.
  CONSTRAINT fk_user_game_game
    FOREIGN KEY (game_id) REFERENCES game (game_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_user_game_rank_tier
    CHECK (rank_tier IS NULL OR rank_tier BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='A user''s game library with per-game rank, hours and goal.';

-- -----------------------------------------------------------------------------
-- availability_slot — when a user can actually play, in UTC minutes from
-- midnight (0-1440), 1:N from user.
--
-- Why integers and not TIME: the match score awards up to 15 points for
-- overlapping availability, and with comparable integers the overlap is a pure
-- arithmetic intersection that SQL computes across every candidate at once:
--
--   SUM(GREATEST(0, LEAST(a.end_minute, b.end_minute)
--                 - GREATEST(a.start_minute, b.start_minute)))
--
-- Storing local times instead would force that comparison into application
-- code, which is anti-pattern C1. Slots crossing midnight UTC are split into
-- two rows at write time so every row satisfies start < end.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_slot (
  slot_id      INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED      NOT NULL,
  day_of_week  TINYINT UNSIGNED  NOT NULL COMMENT '0 = Sunday .. 6 = Saturday, UTC.',
  start_minute SMALLINT UNSIGNED NOT NULL COMMENT 'Minutes from UTC midnight, 0-1439.',
  end_minute   SMALLINT UNSIGNED NOT NULL COMMENT 'Minutes from UTC midnight, 1-1440.',
  created_at   DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (slot_id),
  -- Two identical slots for one user would double-count that time in the
  -- overlap SUM, inflating the score. The UNIQUE makes that impossible.
  UNIQUE KEY uq_availability_slot_user_day_start (user_id, day_of_week, start_minute),
  -- Serves the availability-overlap join in the matchmaking query.
  KEY idx_availability_slot_user_day (user_id, day_of_week, start_minute),
  CONSTRAINT fk_availability_slot_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_availability_slot_day CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT ck_availability_slot_start CHECK (start_minute BETWEEN 0 AND 1439),
  CONSTRAINT ck_availability_slot_end CHECK (end_minute BETWEEN 1 AND 1440),
  -- A zero-length or inverted slot would contribute a negative interval to the
  -- overlap arithmetic and silently corrupt every score it touches.
  CONSTRAINT ck_availability_slot_order CHECK (end_minute > start_minute)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Weekly availability in UTC minutes-from-midnight. 1:N from user.';
