-- Reverses 0009: every trigger, then the primary-game structural guarantee.
DROP TRIGGER IF EXISTS trg_group_member_ai;
DROP TRIGGER IF EXISTS trg_group_member_au;
DROP TRIGGER IF EXISTS trg_group_member_ad;
DROP TRIGGER IF EXISTS trg_message_ai;
DROP TRIGGER IF EXISTS trg_user_bu;
DROP TRIGGER IF EXISTS trg_profile_bu;
DROP TRIGGER IF EXISTS trg_rating_bi;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'user_game'
    AND index_name = 'uq_user_game_one_primary_per_user');
SET @sql := IF(@idx_exists > 0,
  'ALTER TABLE user_game DROP INDEX uq_user_game_one_primary_per_user', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'user_game' AND column_name = 'primary_owner_id');
SET @sql := IF(@col_exists > 0,
  'ALTER TABLE user_game DROP COLUMN primary_owner_id', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
