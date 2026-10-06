# Performance evidence

This page shows, with real `EXPLAIN ANALYZE` output, that the indexes do their
job. We look at **three** queries only: browsing groups, the match query, and
game search. We do not chase tiny optimisations.

## How the numbers were produced

A throwaway database (`faze_perf`) holds the real game catalog (118,001 games)
plus generated data: **20,000 users, 5,000 groups, 12,500 group members, 60,000
owned games and 60,000 availability slots.** The data is plain arithmetic, so
anyone gets the same rows. Timings are in milliseconds, from one development
machine with a warm cache; compare the _before_ and _after_ of each query, not
the absolute numbers.

To repeat it:

```bash
mysql -uroot -proot -e "CREATE DATABASE faze_perf CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
DB_NAME=faze_perf npm run db:migrate
mysql -uroot -proot --default-character-set=utf8mb4 faze_perf < db/perf/load.sql
mysql -uroot -proot --raw -N faze_perf < db/perf/queries.sql
```

(`load.sql` copies the games from the `faze` database, so run `npm run etl:all`
there first.) The queries and their before/after forms are in
[`db/perf/queries.sql`](../db/perf/queries.sql).

## Summary

| Query                                       | Before                                          | After                              | What changed                                                    |
| ------------------------------------------- | ----------------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| 1. Browse open groups for a game and region | 5.47 ms, full scan of 5,000 groups, then a sort | **0.10 ms**, reads 5 index entries | Composite index `idx_lfg_group_recruit` (already in the schema) |
| 2. The match query                          | **295 ms** (median of 5)                        | **164 ms** (median of 5)           | New index `idx_availability_slot_day_time` (migration `0012`)   |
| 3. Game search by title                     | 81.6 ms, full scan of 118,001 games             | **0.21 ms**                        | `FULLTEXT` index `ft_game_title` (already in the schema)        |

## 1. Browse: groups for one game and region

```sql
SELECT group_id, title, member_count FROM lfg_group
 WHERE game_id = 182 AND status = 'recruiting' AND region_id = 5
 ORDER BY last_activity_at DESC LIMIT 20;
```

**Before** (the index ignored, which is what a plain table would give):

```
-> Sort: last_activity_at DESC, limit input to 20 row(s)  (actual time=5.47..5.47 rows=5)
    -> Table scan on g  (actual time=0.0716..4.71 rows=5000)
```

**After:**

```
-> Index lookup on g using idx_lfg_group_recruit
     (game_id=182, status='recruiting', region_id=5) (reverse)  (actual time=0.0323..0.0939 rows=5)
```

The index columns are the same three filters, then `last_activity_at`. MySQL
jumps straight to the 5 matching groups, already in order, so there is **no scan
and no sort**. With only 5,000 groups both finish quickly; the difference is
that the scan grows with the table and the index does not.

## 2. The match query

The query is explained in [`matchmaking.md`](matchmaking.md). Its expensive part
is working out, for every group, how many hours its members are free at the same
time as you.

**Before** (migration 0012 rolled back), the overlap step took **157 ms**:

```
-> Materialize CTE shared  (actual time=157..157 rows=2365)
    -> Inner hash join (no condition)  (actual time=0.454..13.1 rows=37500)
        -> Covering index scan on gm using idx_group_member_user_state  (rows=12500)
        -> Index lookup on a ... (user_id=@uid)  (rows=3)
    -> Index lookup on a using uq_availability_slot_user_day_start  (loops=37500)
```

MySQL started from **every** active member (12,500), paired each with your 3
slots (37,500 pairs) and did one lookup per pair.

**After** (migration 0012: `availability_slot (day_of_week, start_minute,
end_minute, user_id)`), the same step takes **about 32–45 ms**:

```
-> Materialize CTE shared  (actual time=32.1..32.1 rows=2365)
    -> Index lookup on a using uq_availability_slot_user_day_start (user_id=@uid)  (rows=3)
    -> Covering index lookup on a using idx_availability_slot_day_time (day_of_week=a.day_of_week)
    -> Covering index lookup on gm using idx_group_member_user_state  (loops=7144)
```

Now MySQL starts from **your 3 slots**, reads the other slots on the same day
straight from the index, and only then finds those people's groups: about 7,000
lookups instead of 37,500, and no table reads.

Whole query, five runs each, in ms:

|        | Runs (sorted)           | Median  |
| ------ | ----------------------- | ------- |
| Before | 232, 259, 295, 320, 332 | **295** |
| After  | 145, 163, 164, 169, 174 | **164** |

The 20 returned rows are identical before and after (their `md5` hashes match);
an index changes how rows are found, never which rows.

**What is left.** About 100 ms of the remaining time is reading all 5,000 group
cards, because a ranking must score every candidate group before it can pick the
top 20. That is the honest cost of "best match first", and fine at this size. We
did not add a cache or pre-computed scores: more moving parts than a class
project needs.

## 3. Game search

```sql
-- before:                       -- after (what the API runs):
WHERE title LIKE '%counter-strike%'   WHERE MATCH(title) AGAINST ('counter-strike' IN BOOLEAN MODE)
```

**Before:**

```
-> Filter: (game.title like '%counter-strike%')  (actual time=0.124..81.6 rows=5)
    -> Table scan on game  (actual time=0.121..51.8 rows=118001)
```

A `LIKE` with a leading `%` cannot use an ordinary index, so every one of the
118,001 titles is read.

**After:**

```
-> Full-text index search on game using ft_game_title (title='counter-strike')  (actual time=0.0271..0.162 rows=20)
```

The full-text index finds the matching titles directly: about **400 times
faster** here, and it keeps working as the catalog grows.

## What we did not do

No query cache, no summary tables, no partitioning, no extra indexes "just in
case". Every index costs time on every write, and these three earned their place
with the numbers above. A new index needs a before/after like these.
