-- 0012 — an index that lets the match query start from the person's own slots.
--
-- The match query (server/src/repositories/match.repo.ts) finds, for each group,
-- how long its members are free at the same time as the person. Evidence with
-- 20,000 users and 5,000 groups is in docs/performance.md.
--
-- Without this index MySQL starts from group_member, takes every active member
-- (12,500 rows), pairs each with the person's 3 slots (37,500 pairs) and looks
-- each one up. With it, MySQL starts from the person's 3 slots, reads the other
-- slots on the same day in time order straight from the index, and only then
-- finds those users' groups. The overlap step went from 160 ms to 45 ms.
--
-- Column order: day_of_week first (always an equality), then start_minute so the
-- "starts before my slot ends" test is a range scan, then end_minute and user_id
-- so the join needs no table reads (a covering index).
--
-- Guarded, so re-running is a no-op instead of an error (see 0002).
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'availability_slot'
    AND index_name = 'idx_availability_slot_day_time'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE availability_slot ADD KEY idx_availability_slot_day_time (day_of_week, start_minute, end_minute, user_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
