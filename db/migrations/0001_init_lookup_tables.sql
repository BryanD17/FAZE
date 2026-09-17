-- =============================================================================
-- 0001_init_lookup_tables.sql
--
-- Reference data: the small, closed-ish sets that the rest of the schema
-- points at. These are TABLES rather than ENUMs because each one carries
-- attributes beyond its own name (a slug for URLs, an ISO code, a description,
-- and in region's case an adjacency relation). An ENUM cannot hold those, and
-- changing an ENUM's members is an ALTER TABLE on every row.
--
-- The rows themselves are inserted here, not in a seed script: they are part
-- of the schema's meaning, not demo data. A `region_id` FK is meaningless if
-- the regions do not exist, so the two ship together.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + INSERT ... ON DUPLICATE KEY UPDATE,
-- so re-running this file is a no-op rather than an error.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- platform — PC, PlayStation, Xbox, Switch, Mobile.
-- TINYINT is deliberate: this set will never exceed 255 members, and a narrow
-- key keeps the M:N join tables (user_platform, group_platform) small, which
-- matters because the matchmaking query intersects them on every candidate.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform (
  platform_id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(30)      NOT NULL,
  slug        VARCHAR(30)      NOT NULL,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (platform_id),
  UNIQUE KEY uq_platform_name (name),
  UNIQUE KEY uq_platform_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Playable platforms. Referenced by user_platform and group_platform.';

-- -----------------------------------------------------------------------------
-- region — the coarse geography buckets that stand in for latency and timezone.
-- region_id is assigned explicitly (not AUTO_INCREMENT) because region_adjacency
-- below references these ids as data, and a stable id lets that adjacency table
-- be written literally and reviewed by eye.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region (
  region_id  TINYINT UNSIGNED NOT NULL,
  code       VARCHAR(10)      NOT NULL,
  name       VARCHAR(40)      NOT NULL,
  created_at DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (region_id),
  UNIQUE KEY uq_region_code (code),
  UNIQUE KEY uq_region_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Matchmaking regions. Adjacency in region_adjacency scores partial matches.';

-- -----------------------------------------------------------------------------
-- region_adjacency — "close enough to play together" as data, not a CASE
-- expression buried in a query.
--
-- The match score awards 12 points for the same region and 6 for an adjacent
-- one (§5.4). Encoding that neighbourliness in a table means the rule can be
-- corrected with an INSERT instead of a code deploy, and the matchmaking query
-- stays a join rather than a hand-maintained list of region pairs.
--
-- The relation is stored SYMMETRICALLY (both directions inserted) so the query
-- needs one join instead of an OR over two columns, which would defeat the
-- index. The CHECK stops a region being its own neighbour, which would
-- double-count the same-region case.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region_adjacency (
  region_id          TINYINT UNSIGNED NOT NULL,
  adjacent_region_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (region_id, adjacent_region_id),
  KEY idx_region_adjacency_adjacent (adjacent_region_id),
  -- ON UPDATE RESTRICT, not CASCADE, and that is forced as well as correct:
  -- MySQL refuses to let a column carry both a CHECK constraint and an FK
  -- referential action ("Column 'region_id' cannot be used in a check
  -- constraint ... needed in a foreign key constraint referential action").
  -- RESTRICT is the right rule regardless — region_id values are assigned by
  -- hand in this file precisely so they never change, and a region id that
  -- shifted underneath this table would silently rewrite the adjacency rules.
  CONSTRAINT fk_region_adjacency_region
    FOREIGN KEY (region_id) REFERENCES region (region_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_region_adjacency_adjacent
    FOREIGN KEY (adjacent_region_id) REFERENCES region (region_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_region_adjacency_not_self CHECK (region_id <> adjacent_region_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Symmetric region neighbours; drives the +6 adjacent-region score.';

-- -----------------------------------------------------------------------------
-- language — spoken language for voice comms, worth +5 in the match score.
-- ISO 639-1 two-letter codes, so the value is portable and not our invention.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `language` (
  language_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  iso_code    CHAR(2)           NOT NULL,
  name        VARCHAR(40)       NOT NULL,
  created_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (language_id),
  UNIQUE KEY uq_language_iso_code (iso_code),
  UNIQUE KEY uq_language_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='ISO 639-1 languages for voice comms matching.';

-- -----------------------------------------------------------------------------
-- genre — grows as the ETL discovers new genre strings in the Steam data, which
-- is exactly why it is a table and not an ENUM. AUTO_INCREMENT because nothing
-- references genre ids as literal data.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS genre (
  genre_id   SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(60)       NOT NULL,
  slug       VARCHAR(60)       NOT NULL,
  created_at DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (genre_id),
  UNIQUE KEY uq_genre_name (name),
  UNIQUE KEY uq_genre_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Game genres, upserted by slug during the ETL.';

-- -----------------------------------------------------------------------------
-- playstyle_tag — why someone is playing, which is the signal random
-- matchmaking throws away. The description is shown in the onboarding chip
-- picker, so it lives with the tag rather than being duplicated in the client.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playstyle_tag (
  tag_id      SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(40)       NOT NULL,
  slug        VARCHAR(40)       NOT NULL,
  description VARCHAR(140)      NULL,
  created_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tag_id),
  UNIQUE KEY uq_playstyle_tag_name (name),
  UNIQUE KEY uq_playstyle_tag_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Playstyle intent tags; shared tags are worth 5 points each, capped at 10.';

-- =============================================================================
-- Reference rows.
-- ON DUPLICATE KEY UPDATE makes re-application a no-op while still correcting
-- a display name that changed, without disturbing the surrogate ids that other
-- tables point at.
-- =============================================================================

INSERT INTO platform (platform_id, name, slug) VALUES
  (1, 'PC',          'pc'),
  (2, 'PlayStation', 'playstation'),
  (3, 'Xbox',        'xbox'),
  (4, 'Switch',      'switch'),
  (5, 'Mobile',      'mobile')
ON DUPLICATE KEY UPDATE name = VALUES(name), slug = VALUES(slug);

INSERT INTO region (region_id, code, name) VALUES
  (1, 'NA-East', 'North America East'),
  (2, 'NA-West', 'North America West'),
  (3, 'EU-West', 'Europe West'),
  (4, 'EU-East', 'Europe East'),
  (5, 'SA',      'South America'),
  (6, 'APAC',    'Asia Pacific'),
  (7, 'OCE',     'Oceania'),
  (8, 'ME',      'Middle East')
ON DUPLICATE KEY UPDATE code = VALUES(code), name = VALUES(name);

-- Adjacency, inserted in both directions so the relation is symmetric in the
-- data and the query never needs an OR. Pairs chosen for plausible playable
-- latency and overlapping waking hours:
--   NA-East <-> NA-West, NA-East <-> SA, NA-East <-> EU-West
--   EU-West <-> EU-East, EU-East <-> ME, EU-West <-> ME
--   APAC    <-> OCE,     APAC    <-> ME
INSERT INTO region_adjacency (region_id, adjacent_region_id) VALUES
  (1, 2), (2, 1),
  (1, 5), (5, 1),
  (1, 3), (3, 1),
  (3, 4), (4, 3),
  (4, 8), (8, 4),
  (3, 8), (8, 3),
  (6, 7), (7, 6),
  (6, 8), (8, 6)
ON DUPLICATE KEY UPDATE region_id = VALUES(region_id);

INSERT INTO `language` (language_id, iso_code, name) VALUES
  (1,  'en', 'English'),
  (2,  'es', 'Spanish'),
  (3,  'pt', 'Portuguese'),
  (4,  'fr', 'French'),
  (5,  'de', 'German'),
  (6,  'ru', 'Russian'),
  (7,  'ja', 'Japanese'),
  (8,  'ko', 'Korean'),
  (9,  'zh', 'Chinese'),
  (10, 'ar', 'Arabic'),
  (11, 'it', 'Italian'),
  (12, 'pl', 'Polish')
ON DUPLICATE KEY UPDATE iso_code = VALUES(iso_code), name = VALUES(name);

-- The nine tags from §5.3. Descriptions are user-facing copy.
INSERT INTO playstyle_tag (tag_id, name, slug, description) VALUES
  (1, 'Casual',       'casual',       'Here to relax. Wins are nice, not the point.'),
  (2, 'Competitive',  'competitive',  'Playing to win and expects teammates to try.'),
  (3, 'Ranked Grind', 'ranked-grind', 'Climbing the ladder, playing most nights.'),
  (4, 'Completionist','completionist','Achievements, collectibles and 100% clears.'),
  (5, 'Chill Vibes',  'chill-vibes',  'Good company first. No pressure, no yelling.'),
  (6, 'Coach',        'coach',        'Happy to teach mechanics and review mistakes.'),
  (7, 'First-Timer',  'first-timer',  'New to this game and learning the basics.'),
  (8, 'Roleplay',     'roleplay',     'In character, story-first, immersion matters.'),
  (9, 'Speedrun',     'speedrun',     'Optimising routes and chasing personal bests.')
ON DUPLICATE KEY UPDATE name = VALUES(name), slug = VALUES(slug),
                        description = VALUES(description);
