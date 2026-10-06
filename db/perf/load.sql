-- Bulk data for the EXPLAIN evidence in docs/performance.md.
--
-- Run it against a THROWAWAY database, never `faze`:
--
--   mysql -uroot -proot -e "CREATE DATABASE faze_perf CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
--   DB_NAME=faze_perf npm run db:migrate
--   mysql -uroot -proot --default-character-set=utf8mb4 faze_perf < db/perf/load.sql
--
-- It copies the real game catalog from the `faze` database (run `npm run
-- etl:all` there first), then adds 20,000 users and 5,000 groups made from plain
-- arithmetic, so every run produces exactly the same rows. Games are spread over
-- a pool of 500 multiplayer titles so that many people and groups share a game,
-- which is what makes matching expensive.

SET SESSION cte_max_recursion_depth = 100000;

-- 1. The real catalog -------------------------------------------------------
INSERT INTO game SELECT * FROM faze.game;
INSERT INTO genre SELECT * FROM faze.genre;
INSERT INTO game_genre SELECT * FROM faze.game_genre;
INSERT INTO game_platform SELECT * FROM faze.game_platform;

-- 2. Helpers: the numbers 1..20000 and a pool of 500 multiplayer games ------
CREATE TABLE perf_n AS
  WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000)
  SELECT i FROM n;

CREATE TABLE perf_pool AS
  SELECT game_id, ROW_NUMBER() OVER (ORDER BY game_id) AS rn
    FROM game WHERE is_multiplayer = 1 LIMIT 500;

-- 3. 20,000 users with profiles ---------------------------------------------
INSERT INTO `user` (email, password_hash, status, email_verified_at)
  SELECT CONCAT('perf', i, '@perf.faze'), 'not-a-real-hash', 'active', NOW() FROM perf_n;

INSERT INTO profile (user_id, display_name, region_id, timezone)
  SELECT user_id, CONCAT('perf-user-', user_id), 1 + MOD(user_id * 7, 8), 'UTC' FROM `user`;

-- 4. Three games and three weekly slots each (UTC minutes since midnight) ---
INSERT INTO user_game (user_id, game_id)
  SELECT u.user_id, p.game_id
    FROM `user` u
    JOIN (SELECT 1 AS k UNION SELECT 2 UNION SELECT 3) k
    JOIN perf_pool p ON p.rn = 1 + MOD(u.user_id * 17 + k.k * 101, 500);

INSERT INTO availability_slot (user_id, day_of_week, start_minute, end_minute)
  SELECT u.user_id,
         MOD(u.user_id + k.k * 2, 7),
         60 * (8 + MOD(u.user_id + k.k * 5, 14)),
         60 * (8 + MOD(u.user_id + k.k * 5, 14)) + 120
    FROM `user` u
    JOIN (SELECT 1 AS k UNION SELECT 2 UNION SELECT 3) k;

-- 5. 5,000 open groups with 1-4 members each (triggers keep member_count) ---
INSERT INTO lfg_group (owner_user_id, game_id, title, region_id, visibility, status,
                       max_members, last_activity_at)
  SELECT 1 + MOD(n.i * 37, 20000),
         p.game_id,
         CONCAT('Perf group ', n.i),
         1 + MOD(n.i, 8),
         'open', 'recruiting',
         5 + MOD(n.i, 4),
         NOW() - INTERVAL MOD(n.i * 13, 10000) MINUTE
    FROM perf_n n
    JOIN perf_pool p ON p.rn = 1 + MOD(n.i * 31, 500)
   WHERE n.i <= 5000;

INSERT INTO group_platform (group_id, platform_id)
  SELECT group_id, 1 FROM lfg_group;

-- The member-count trigger updates lfg_group, and MySQL forbids reading a table
-- in the same statement whose trigger writes to it (ERROR 1442), so read the
-- groups from a copy.
CREATE TABLE perf_groups AS SELECT group_id, owner_user_id FROM lfg_group;

INSERT INTO group_member (group_id, user_id, role, state)
  SELECT g.group_id,
         1 + MOD(g.owner_user_id + k.k * 4999, 20000),
         IF(k.k = 0, 'owner', 'member'),
         'active'
    FROM perf_groups g
    JOIN (SELECT 0 AS k UNION SELECT 1 UNION SELECT 2 UNION SELECT 3) k
      ON k.k <= MOD(g.group_id, 4);

-- 6. Clean up helpers and refresh the optimiser's statistics ----------------
DROP TABLE perf_n;
DROP TABLE perf_pool;
DROP TABLE perf_groups;
ANALYZE TABLE game, game_genre, user_game, availability_slot, lfg_group, group_member, profile;

SELECT 'users' AS what, COUNT(*) AS n FROM `user`
UNION ALL SELECT 'groups', COUNT(*) FROM lfg_group
UNION ALL SELECT 'group members', COUNT(*) FROM group_member
UNION ALL SELECT 'user_game', COUNT(*) FROM user_game
UNION ALL SELECT 'availability slots', COUNT(*) FROM availability_slot
UNION ALL SELECT 'games', COUNT(*) FROM game
UNION ALL SELECT 'groups with member_count drift (must be 0)', COUNT(*) FROM v_member_count_reconciliation WHERE drift <> 0;
