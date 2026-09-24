-- =============================================================================
-- 0006_init_staging_and_etl.sql
--
-- The staging layer and the ETL's bookkeeping.
--
-- Raw source rows NEVER land in a production table. They land here, in tables
-- whose types are deliberately loose (TEXT everywhere a source might hand us
-- dirt), get validated, and are then transformed into the normalized core.
-- That separation is what lets the pipeline reject a bad row with a reason
-- instead of either crashing or silently writing garbage into `game`.
--
-- Staging tables are scratch: they are TRUNCATEd and reloaded on every run,
-- carry no foreign keys into the core schema, and nothing in the application
-- ever reads them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- stg_steam_game — one row per Steam app, exactly as the source presents it.
--
-- Every column is TEXT even where the value looks numeric or date-shaped,
-- because "2018-02-08", "N", "" and "Coming soon" all appear in the same
-- release_date column upstream. Typing this column as DATE would make the
-- loader crash on the first bad row; typing it as TEXT lets the TRANSFORM
-- stage decide, log a reject reason, and keep going.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stg_steam_game (
  steam_appid       INT UNSIGNED NOT NULL,
  name              TEXT NULL,
  release_date      TEXT NULL,
  app_type          TEXT NULL COMMENT '"game", "demo", "dlc" — only "game" is promoted.',
  is_free           TEXT NULL,
  languages         TEXT NULL,
  developer         TEXT NULL,
  publisher         TEXT NULL,
  owners_range      TEXT NULL COMMENT 'A bucket string such as "1,000,000 .. 2,000,000".',
  concurrent_users  TEXT NULL,
  loaded_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (steam_appid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Staging: raw Steam app rows. Loose types on purpose — staging accepts dirt.';

-- -----------------------------------------------------------------------------
-- stg_steam_genre / stg_steam_category — the source publishes these as separate
-- long-format files (one row per app/value) rather than as delimited strings in
-- the main table, so staging mirrors that shape instead of re-flattening it.
--
-- No primary key on (appid, value): staging must be able to hold a duplicate
-- the source contains, so that the transform can COUNT it and report it as a
-- data-quality finding. A PK here would silently discard the evidence.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stg_steam_genre (
  steam_appid INT UNSIGNED NOT NULL,
  genre       VARCHAR(255) NULL,
  loaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_stg_steam_genre_appid (steam_appid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Staging: one row per (app, genre) as published upstream.';

CREATE TABLE IF NOT EXISTS stg_steam_category (
  steam_appid INT UNSIGNED NOT NULL,
  category    VARCHAR(255) NULL,
  loaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_stg_steam_category_appid (steam_appid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Staging: one row per (app, category). Drives is_multiplayer and party size.';

-- -----------------------------------------------------------------------------
-- stg_rawg_game — the enrichment source, stored as the whole JSON payload.
-- Staging a third-party response verbatim means a change in their field names
-- breaks the transform (loudly, in one place) rather than the loader.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stg_rawg_game (
  rawg_id   INT UNSIGNED NOT NULL,
  payload   JSON NOT NULL,
  loaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rawg_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Staging: raw RAWG API responses for cover art and metadata enrichment.';

-- -----------------------------------------------------------------------------
-- etl_run — one row per pipeline stage execution.
--
-- Without this, "how many rows did we load and how many did we throw away?" is
-- unanswerable after the fact, and the data-quality section of the Phase 1
-- report would be guesswork. rows_in / rows_loaded / rows_rejected must always
-- reconcile, and docs/data.md quotes them from a real run.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etl_run (
  run_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  source        VARCHAR(40)  NOT NULL COMMENT 'The stage: steam_csv, transform, rawg, curate.',
  rows_in       INT UNSIGNED NOT NULL DEFAULT 0,
  rows_loaded   INT UNSIGNED NOT NULL DEFAULT 0,
  rows_rejected INT UNSIGNED NOT NULL DEFAULT 0,
  started_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME     NULL,
  status        ENUM('running','success','failed') NOT NULL DEFAULT 'running',
  notes         VARCHAR(1000) NULL,
  PRIMARY KEY (run_id),
  KEY idx_etl_run_source_started (source, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Audit of every ETL stage execution. Rendered by the admin console.';

-- -----------------------------------------------------------------------------
-- etl_reject — every row the pipeline refused, with why.
--
-- A silent drop is a bug (§1.7). If a title is missing from the catalog, this
-- table is where the answer lives. `raw_row` keeps the offending input so the
-- finding is reproducible without re-downloading the source.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etl_reject (
  reject_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id      INT UNSIGNED    NOT NULL,
  natural_key VARCHAR(120)    NULL COMMENT 'The steam_appid or slug, when one could be read.',
  reason      VARCHAR(300)    NOT NULL,
  raw_row     JSON            NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reject_id),
  -- Serves the reject taxonomy query: GROUP BY reason.
  KEY idx_etl_reject_run_reason (run_id, reason),
  CONSTRAINT fk_etl_reject_run
    FOREIGN KEY (run_id) REFERENCES etl_run (run_id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Rejected source rows with a reason. Silent drops are a bug.';

-- -----------------------------------------------------------------------------
-- game.is_curated — marks the shortlist of titles people actually form groups
-- for, used by the onboarding "popular games" picker.
--
-- A column on `game` rather than a separate table because it is a single
-- boolean attribute of a game, functionally dependent on game_id, so a
-- separate relation would add a join without removing any redundancy.
-- Guarded ALTER so re-running this migration is a no-op.
-- -----------------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'game' AND column_name = 'is_curated'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE game
     ADD COLUMN is_curated BOOLEAN NOT NULL DEFAULT 0
       COMMENT ''On the curated multiplayer shortlist shown during onboarding.''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Serves the onboarding picker: curated multiplayer games, most-owned first.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'game'
    AND index_name = 'idx_game_curated_multiplayer'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX idx_game_curated_multiplayer ON game (is_curated, is_multiplayer)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
