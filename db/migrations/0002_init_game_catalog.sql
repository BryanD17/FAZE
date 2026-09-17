-- =============================================================================
-- 0002_init_game_catalog.sql
--
-- The game catalog. Populated by the ETL (AGENT 02) from Kaggle Steam dumps
-- and enriched from RAWG/IGDB, so every column here is either something a
-- source actually provides or something we derive deterministically from one.
--
-- Nothing in this file invents data. Where a source cannot tell us a value the
-- column is NULL, because NULL means "unknown" and never "zero" or "false"
-- (convention B.1).
-- =============================================================================

CREATE TABLE IF NOT EXISTS game (
  game_id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  title             VARCHAR(255)  NOT NULL,

  -- The stable, human-readable identifier used in URLs and as the ETL's
  -- de-duplication key. UNIQUE because two rows for the same game would split
  -- a game's groups into two populations that cannot find each other — the
  -- worst failure this product can have.
  slug              VARCHAR(255)  NOT NULL,

  release_date      DATE          NULL
    COMMENT 'NULL when the source date could not be parsed; never guessed.',

  -- Natural keys from the three upstream sources. Each is UNIQUE so an upsert
  -- can key on it, and NULLable because most games appear in only one source.
  -- MySQL permits many NULLs in a UNIQUE index, which is exactly what we want.
  steam_appid       INT UNSIGNED  NULL,
  rawg_id           INT UNSIGNED  NULL,
  igdb_id           INT UNSIGNED  NULL,

  cover_url         VARCHAR(500)  NULL,
  short_description VARCHAR(1000) NULL,
  metacritic        TINYINT UNSIGNED NULL
    COMMENT '0-100 critic score; TINYINT UNSIGNED fits the domain exactly.',

  -- Steam publishes ownership as a bucket string ("1,000,000 - 2,000,000"),
  -- not a number. Storing the bucket verbatim is honest; converting it to a
  -- number would be inventing precision the source does not have. The ETL
  -- parses it for ordering only.
  estimated_owners  VARCHAR(40)   NULL,

  is_multiplayer    BOOLEAN       NOT NULL DEFAULT 0
    COMMENT 'Derived from Steam category strings. Groups may only form on 1.',
  max_party_size    TINYINT UNSIGNED NULL
    COMMENT 'Parsed from category text ("4-player Co-op"); NULL when unknown.',

  -- Provenance only (zyBooks Ch. 8). Keeping the original API response means a
  -- later ETL run can extract a field we did not think to normalize today.
  -- Business logic MUST NOT read from this column: it is not indexable the way
  -- a typed column is, and querying rules out of it would quietly undo the
  -- normalization work.
  raw_payload       JSON          NULL,

  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id),
  UNIQUE KEY uq_game_slug (slug),
  UNIQUE KEY uq_game_steam_appid (steam_appid),
  UNIQUE KEY uq_game_rawg_id (rawg_id),
  UNIQUE KEY uq_game_igdb_id (igdb_id),
  CONSTRAINT ck_game_metacritic_range
    CHECK (metacritic IS NULL OR metacritic <= 100),
  CONSTRAINT ck_game_max_party_size
    CHECK (max_party_size IS NULL OR max_party_size BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Game catalog from Kaggle Steam data, enriched via RAWG/IGDB.';

-- Fulltext on the title powers the onboarding game picker and the top-bar
-- search. Serves: GET /api/games/search?q=  (AGENT 05).
-- Added via a guarded ALTER rather than inline so re-running this migration on
-- a database that already has the index is a no-op instead of an error —
-- CREATE TABLE IF NOT EXISTS silently skips a table that exists, which would
-- otherwise leave a half-upgraded schema undetected.
SET @ft_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'game' AND index_name = 'ft_game_title'
);
SET @sql := IF(@ft_exists = 0,
  'ALTER TABLE game ADD FULLTEXT INDEX ft_game_title (title)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- game_genre — M:N. A pure join table, so the primary key is the composite
-- natural key: a game cannot be tagged with the same genre twice, and that
-- guarantee is structural rather than enforced by application code.
--
-- ON DELETE CASCADE on both sides: a genre link has no meaning without both
-- of its parents, so an orphan row is not something we would ever want to keep.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_genre (
  game_id  INT UNSIGNED      NOT NULL,
  genre_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (game_id, genre_id),
  -- Reverse lookup: "which games are in this genre", used by the empty-result
  -- suggestions in the matchmaking endpoint (AGENT 07 task 5).
  KEY idx_game_genre_genre (genre_id),
  CONSTRAINT fk_game_genre_game
    FOREIGN KEY (game_id) REFERENCES game (game_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_game_genre_genre
    FOREIGN KEY (genre_id) REFERENCES genre (genre_id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='M:N game <-> genre.';

-- -----------------------------------------------------------------------------
-- game_platform — M:N. Which platforms a game is released on, which bounds
-- which platforms a group for that game can require.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_platform (
  game_id     INT UNSIGNED     NOT NULL,
  platform_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (game_id, platform_id),
  KEY idx_game_platform_platform (platform_id),
  CONSTRAINT fk_game_platform_game
    FOREIGN KEY (game_id) REFERENCES game (game_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- RESTRICT, not CASCADE: deleting a platform that games are released on
  -- should fail loudly. The five platform rows are reference data; if one is
  -- ever removed that is a schema decision, not a row deletion.
  CONSTRAINT fk_game_platform_platform
    FOREIGN KEY (platform_id) REFERENCES platform (platform_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='M:N game <-> platform.';
