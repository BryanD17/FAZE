-- EXPLAIN ANALYZE for the three queries in docs/performance.md.
-- Run on the throwaway database built by db/perf/load.sql:
--
--   mysql -uroot -proot --raw -N faze_perf < db/perf/queries.sql
--
-- Each query shows its "before" form (what you would get without the index or
-- technique) and its "after" form (what the application runs).
--
-- To get the "before" for query 2, roll migration 0012 back first
-- (DB_NAME=faze_perf node db/scripts/rollback.js) and re-apply it afterwards
-- (DB_NAME=faze_perf npm run db:migrate).

-- =============================================================================
-- 1. Browse: open groups for one game and region, newest activity first.
--    Index: idx_lfg_group_recruit (game_id, status, region_id, last_activity_at)
-- =============================================================================

SELECT '1a. BEFORE: index ignored' AS step;
EXPLAIN ANALYZE
SELECT g.group_id, g.title, g.member_count
  FROM lfg_group g IGNORE INDEX (idx_lfg_group_recruit, fk_lfg_group_region)
 WHERE g.game_id = 182 AND g.status = 'recruiting' AND g.region_id = 5
 ORDER BY g.last_activity_at DESC LIMIT 20;

SELECT '1b. AFTER: the composite index' AS step;
EXPLAIN ANALYZE
SELECT g.group_id, g.title, g.member_count
  FROM lfg_group g
 WHERE g.game_id = 182 AND g.status = 'recruiting' AND g.region_id = 5
 ORDER BY g.last_activity_at DESC LIMIT 20;

-- =============================================================================
-- 2. The match query (same SQL as server/src/repositories/match.repo.ts, with
--    user variables in place of the named parameters).
--    Index: idx_availability_slot_day_time (migration 0012)
-- =============================================================================

SET @uid = 1234, @gw = 50, @rw = 20, @aw = 30, @fh = 10;

SELECT '2. Match query (run before and after migration 0012)' AS step;
EXPLAIN ANALYZE
WITH shared AS (
  SELECT gm.group_id,
         SUM(LEAST(mine.end_minute, theirs.end_minute) - GREATEST(mine.start_minute, theirs.start_minute)) AS shared_minutes
    FROM group_member gm
    JOIN v_user_availability_minutes theirs ON theirs.user_id = gm.user_id
    JOIN v_user_availability_minutes mine
      ON mine.user_id = @uid AND mine.day_of_week = theirs.day_of_week
     AND mine.start_minute < theirs.end_minute AND theirs.start_minute < mine.end_minute
   WHERE gm.state = 'active'
   GROUP BY gm.group_id
),
candidate AS (
  SELECT g.*,
         COALESCE(g.game_id IN (SELECT ug.game_id FROM user_game ug WHERE ug.user_id = @uid), 0) AS same_game,
         COALESCE(g.region_id = (SELECT p.region_id FROM profile p WHERE p.user_id = @uid), 0) AS same_region,
         COALESCE(s.shared_minutes / 60 / NULLIF(g.member_count, 0), 0) AS overlap_hours
    FROM v_group_card g
    LEFT JOIN shared s ON s.group_id = g.group_id
   WHERE g.visibility = 'open' AND g.status = 'recruiting' AND g.open_slots > 0
     AND NOT EXISTS (SELECT 1 FROM group_member me WHERE me.group_id = g.group_id AND me.user_id = @uid AND me.state = 'active')
),
scored AS (
  SELECT candidate.*, @gw * same_game + @rw * same_region + LEAST(@aw, @aw * overlap_hours / @fh) AS score FROM candidate
)
SELECT group_id, ROUND(score) AS score
  FROM scored WHERE score > 0
 ORDER BY score DESC, last_activity_at DESC, group_id LIMIT 20;

-- =============================================================================
-- 3. Game search by title.
--    Index: ft_game_title (FULLTEXT on game.title)
-- =============================================================================

SELECT '3a. BEFORE: LIKE scans every game' AS step;
EXPLAIN ANALYZE
SELECT game_id, title FROM game WHERE title LIKE '%counter-strike%' LIMIT 20;

SELECT '3b. AFTER: FULLTEXT (what GET /api/games/search runs)' AS step;
EXPLAIN ANALYZE
SELECT game_id, title, MATCH(title) AGAINST ('counter-strike' IN BOOLEAN MODE) AS score
  FROM game WHERE MATCH(title) AGAINST ('counter-strike' IN BOOLEAN MODE)
 ORDER BY score DESC, game_id LIMIT 20;
