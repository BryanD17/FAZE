-- Reverses 0012. Guarded so it is safe to run twice.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'availability_slot'
    AND index_name = 'idx_availability_slot_day_time'
);
SET @sql := IF(@idx_exists > 0,
  'ALTER TABLE availability_slot DROP KEY idx_availability_slot_day_time',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
