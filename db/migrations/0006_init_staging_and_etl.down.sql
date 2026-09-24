-- Reverses 0006. etl_reject before etl_run (FK), then staging, then the column.
DROP TABLE IF EXISTS etl_reject;
DROP TABLE IF EXISTS etl_run;
DROP TABLE IF EXISTS stg_rawg_game;
DROP TABLE IF EXISTS stg_steam_category;
DROP TABLE IF EXISTS stg_steam_genre;
DROP TABLE IF EXISTS stg_steam_game;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'game'
    AND index_name = 'idx_game_curated_multiplayer');
SET @sql := IF(@idx_exists > 0, 'DROP INDEX idx_game_curated_multiplayer ON game', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'game' AND column_name = 'is_curated');
SET @sql := IF(@col_exists > 0, 'ALTER TABLE game DROP COLUMN is_curated', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
