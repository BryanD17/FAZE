-- =============================================================================
-- 0007_views.sql
--
-- The read surfaces the application queries against. A view is not a
-- shortcut around writing the join twice — each one here exists because
-- multiple call sites need the identical shape and the identical business
-- rule for computing it, and a view is the one place that rule can live so
-- it can never drift between callers.
--
-- Every view is CREATE OR REPLACE, so this file is idempotent and safe to
-- re-run after a column is added elsewhere.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_group_card — the shape the browse list and every group-summary card in
-- the UI reads. One row per group; GROUP_CONCAT collapses the group's M:N
-- platforms into a single display-ready list so the API does not have to
-- assemble it from N separate rows per group.
--
-- open_slots is computed here (max_members - member_count) rather than
-- forcing every caller to know that subtraction is the definition of "open
-- slots" — one definition, one place.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_group_card AS
SELECT
  g.group_id,
  g.title,
  g.visibility,
  g.status,
  g.game_id,
  gm.title            AS game_title,
  gm.cover_url        AS game_cover_url,
  g.region_id,
  r.code              AS region_code,
  g.owner_user_id,
  p.display_name      AS owner_display_name,
  g.max_members,
  g.member_count,
  (g.max_members - g.member_count) AS open_slots,
  g.mic_required,
  g.min_age,
  g.rank_floor,
  g.rank_ceiling,
  g.last_activity_at,
  g.created_at,
  (
    SELECT GROUP_CONCAT(pl.slug ORDER BY pl.slug SEPARATOR ',')
    FROM group_platform gp
    JOIN platform pl ON pl.platform_id = gp.platform_id
    WHERE gp.group_id = g.group_id
  ) AS platform_slugs
FROM lfg_group g
JOIN game gm            ON gm.game_id = g.game_id
JOIN profile p           ON p.user_id = g.owner_user_id
LEFT JOIN region r       ON r.region_id = g.region_id;

-- -----------------------------------------------------------------------------
-- v_user_profile_full — the shape GET /api/auth/me and GET /api/profile/:name
-- both read. One profile row, its region/language names resolved, its
-- platform and tag lists collapsed, and its self-declared primary game
-- surfaced without the caller needing to know user_game's is_primary rule.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_user_profile_full AS
SELECT
  u.user_id,
  u.email,
  u.status              AS account_status,
  p.display_name,
  p.bio,
  p.avatar_url,
  p.birth_year,
  p.timezone,
  p.mic_available,
  p.region_id,
  r.code                 AS region_code,
  p.language_id,
  l.iso_code             AS language_code,
  l.name                 AS language_name,
  (
    SELECT GROUP_CONCAT(pl.slug ORDER BY pl.slug SEPARATOR ',')
    FROM user_platform up
    JOIN platform pl ON pl.platform_id = up.platform_id
    WHERE up.user_id = u.user_id
  ) AS platform_slugs,
  (
    SELECT GROUP_CONCAT(t.slug ORDER BY t.slug SEPARATOR ',')
    FROM user_tag ut
    JOIN playstyle_tag t ON t.tag_id = ut.tag_id
    WHERE ut.user_id = u.user_id
  ) AS tag_slugs,
  (
    SELECT ug.game_id
    FROM user_game ug
    WHERE ug.user_id = u.user_id AND ug.is_primary = 1
    LIMIT 1
  ) AS primary_game_id,
  p.created_at           AS profile_created_at
FROM `user` u
JOIN profile p            ON p.user_id = u.user_id
LEFT JOIN region r        ON r.region_id = p.region_id
LEFT JOIN `language` l    ON l.language_id = p.language_id;

-- -----------------------------------------------------------------------------
-- v_user_availability_minutes — a clean pass-through surface for the
-- matchmaking overlap arithmetic (AGENT 07). It exists so the matchmaking
-- query joins against a named, documented view instead of the base table
-- directly, and so a future column added to availability_slot for another
-- purpose does not silently change the shape that query depends on.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_user_availability_minutes AS
SELECT
  a.slot_id,
  a.user_id,
  a.day_of_week,
  a.start_minute,
  a.end_minute
FROM availability_slot a;

-- -----------------------------------------------------------------------------
-- v_group_activity — recency signal for the +3 "recent activity" match score
-- component and the browse sort. messages_7d and joins_7d are windowed at
-- query time (NOW() - INTERVAL 7 DAY) rather than materialized, because a
-- materialized 7-day window would need its own maintenance trigger that
-- re-fires every single day even when nothing about the group changed —
-- more moving parts than the number of rows justifies.
--
-- activity_score is a simple, defensible weighting (messages count double a
-- join, since a message is a stronger signal of a group actually being
-- played by real people) rather than a machine-learned score — this is a
-- database course, and the formula is meant to be readable in one line.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_group_activity AS
SELECT
  g.group_id,
  (
    SELECT MAX(m.created_at) FROM message m
    WHERE m.group_id = g.group_id AND m.deleted_at IS NULL
  ) AS last_message_at,
  (
    SELECT COUNT(*) FROM message m
    WHERE m.group_id = g.group_id AND m.deleted_at IS NULL
      AND m.created_at >= NOW() - INTERVAL 7 DAY
  ) AS messages_7d,
  (
    SELECT COUNT(*) FROM group_member gmem
    WHERE gmem.group_id = g.group_id AND gmem.state = 'active'
      AND gmem.joined_at >= NOW() - INTERVAL 7 DAY
  ) AS joins_7d,
  (
    SELECT COUNT(*) FROM message m
    WHERE m.group_id = g.group_id AND m.deleted_at IS NULL
      AND m.created_at >= NOW() - INTERVAL 7 DAY
  ) * 2
  +
  (
    SELECT COUNT(*) FROM group_member gmem
    WHERE gmem.group_id = g.group_id AND gmem.state = 'active'
      AND gmem.joined_at >= NOW() - INTERVAL 7 DAY
  ) AS activity_score
FROM lfg_group g;

-- -----------------------------------------------------------------------------
-- v_member_count_reconciliation — the honesty check on the ONE deliberate
-- denormalization in this schema (docs/schema.md §6). lfg_group.member_count
-- is maintained exclusively by triggers (0009) for query performance; this
-- view recomputes the true count independently and reports the difference.
--
-- `drift` must be zero for every row, always. The admin data-health panel
-- (AGENT 14) renders this view directly, and AGENT 15's fuzz test asserts
-- `WHERE drift <> 0` returns empty after 100 randomized membership
-- operations. A non-zero drift here means a trigger is wrong or an
-- application code path wrote member_count directly — both are defects.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_member_count_reconciliation AS
SELECT
  g.group_id,
  g.member_count                                AS stored_member_count,
  COUNT(gm.user_id)                              AS actual_member_count,
  (g.member_count - COUNT(gm.user_id))           AS drift
FROM lfg_group g
LEFT JOIN group_member gm
  ON gm.group_id = g.group_id AND gm.state = 'active'
GROUP BY g.group_id, g.member_count;

-- -----------------------------------------------------------------------------
-- v_game_popularity — powers the onboarding "popular games" picker and a
-- trending-games panel. active_group_count counts groups still recruiting or
-- active players in them right now; searching_user_count counts distinct
-- users who have this game in their library and therefore are candidates
-- the matchmaking query would consider for it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_game_popularity AS
SELECT
  gm.game_id,
  gm.title,
  gm.is_curated,
  (
    SELECT COUNT(*) FROM lfg_group g
    WHERE g.game_id = gm.game_id AND g.status IN ('recruiting', 'active')
  ) AS active_group_count,
  (
    SELECT COUNT(DISTINCT ug.user_id) FROM user_game ug
    WHERE ug.game_id = gm.game_id
  ) AS searching_user_count
FROM game gm
WHERE gm.is_multiplayer = 1;
