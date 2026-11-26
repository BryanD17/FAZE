import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../db/pool.js';
import type { Db } from './user.repo.js';

/**
 * The match score, out of 100. The numbers live here so the SQL below and the
 * docs (docs/matchmaking.md) can be checked against one definition.
 */
export const MATCH_WEIGHTS = {
  game: 50, // the group plays a game the person has in their library
  region: 20, // same region
  availability: 30, // the most the availability part can add
  fullAvailabilityHours: 10, // shared hours per week that earn the full 30
} as const;

export const MATCH_LIMIT = 20;

export interface MatchResult {
  groupId: number;
  title: string;
  gameId: number;
  gameTitle: string;
  gameCoverUrl: string | null;
  regionCode: string | null;
  ownerDisplayName: string;
  memberCount: number;
  maxMembers: number;
  openSlots: number;
  platforms: string[];
  /** 0–100. Always above 0: a group with nothing in common is not a match. */
  score: number;
  /** Why the group scored: the three parts, so a screen can explain itself. */
  sameGame: boolean;
  sameRegion: boolean;
  /** Average weekly hours the person is free at the same time as one member. */
  overlapHours: number;
}

interface MatchRecord extends RowDataPacket {
  group_id: number;
  title: string;
  game_id: number;
  game_title: string;
  game_cover_url: string | null;
  region_code: string | null;
  owner_display_name: string;
  member_count: number;
  max_members: number;
  open_slots: number;
  platform_slugs: string | null;
  score: number;
  same_game: number;
  same_region: number;
  overlap_hours: number;
}

/**
 * Open groups for one person, best match first.
 *
 * The whole ranking is this one query; Node only passes the user id in and
 * reshapes the rows. For each group that can still be joined:
 *
 *   score = 50 × (the group's game is in the person's library)
 *         + 20 × (same region)
 *         + up to 30 for availability
 *
 * Availability: a group has no schedule of its own, so we use its members'.
 * `shared` adds up, for every active member, the minutes the person's weekly
 * slots overlap that member's slots. Dividing by the member count gives the
 * average weekly time the person shares with one member. Ten hours or more
 * earns the full 30 points; less earns a proportional share.
 *
 * Slots are stored as UTC minutes since midnight, so two slots overlap when
 * both start before the other ends, and the overlap is
 * LEAST(ends) − GREATEST(starts). No time-zone arithmetic is needed here.
 *
 * Not offered: groups that are full, not open to join, or that the person is
 * already in. Ties are broken by the most recently active group.
 *
 * `STRAIGHT_JOIN` in `shared` keeps the join order: the person's few slots
 * first, so the availability index finds only the slots that overlap them.
 * Left to itself, MySQL starts from every active member instead, which is
 * about 3.5 times slower at 100,000 users. For the same reason the full group
 * card (game, owner, platforms) is joined only to the top rows, and `MERGE(c)`
 * stops MySQL from building the card view for every group first. Together
 * these took the query from 941 ms to 209 ms at 100,000 users
 * (docs/experiments.md).
 */
export async function findMatches(
  userId: number,
  limit: number = MATCH_LIMIT,
  db: Db = pool,
): Promise<MatchResult[]> {
  const [rows] = await db.query<MatchRecord[]>(
    `WITH shared AS (
       SELECT STRAIGHT_JOIN gm.group_id,
              SUM(LEAST(mine.end_minute, theirs.end_minute)
                  - GREATEST(mine.start_minute, theirs.start_minute)) AS shared_minutes
         FROM v_user_availability_minutes mine
         JOIN v_user_availability_minutes theirs
           ON theirs.day_of_week = mine.day_of_week
          AND theirs.start_minute < mine.end_minute
          AND mine.start_minute < theirs.end_minute
         JOIN group_member gm ON gm.user_id = theirs.user_id AND gm.state = 'active'
        WHERE mine.user_id = :userId
        GROUP BY gm.group_id
     ),
     candidate AS (
       SELECT g.group_id, g.last_activity_at,
              COALESCE(g.game_id IN (SELECT ug.game_id FROM user_game ug WHERE ug.user_id = :userId), 0)
                AS same_game,
              COALESCE(g.region_id = (SELECT p.region_id FROM profile p WHERE p.user_id = :userId), 0)
                AS same_region,
              COALESCE(s.shared_minutes / 60 / NULLIF(g.member_count, 0), 0) AS overlap_hours
         FROM lfg_group g
         JOIN profile owner ON owner.user_id = g.owner_user_id
         LEFT JOIN shared s ON s.group_id = g.group_id
        WHERE g.visibility = 'open'
          AND g.status = 'recruiting'
          AND g.member_count < g.max_members
          AND NOT EXISTS (
                SELECT 1 FROM group_member me
                 WHERE me.group_id = g.group_id AND me.user_id = :userId AND me.state = 'active')
     ),
     top_scored AS (
       SELECT candidate.*,
              :gameWeight * same_game
              + :regionWeight * same_region
              + LEAST(:availabilityWeight,
                      :availabilityWeight * overlap_hours / :fullHours) AS score
         FROM candidate
        HAVING score > 0
        ORDER BY score DESC, last_activity_at DESC, group_id
        LIMIT :limit
     )
     SELECT /*+ MERGE(c) */ c.group_id, c.title, c.game_id, c.game_title, c.game_cover_url, c.region_code,
            c.owner_display_name, c.member_count, c.max_members, c.open_slots, c.platform_slugs,
            ROUND(t.score) AS score, t.same_game, t.same_region,
            ROUND(t.overlap_hours, 1) AS overlap_hours
       FROM top_scored t
       JOIN v_group_card c ON c.group_id = t.group_id
      ORDER BY t.score DESC, t.last_activity_at DESC, t.group_id`,
    {
      userId,
      limit,
      gameWeight: MATCH_WEIGHTS.game,
      regionWeight: MATCH_WEIGHTS.region,
      availabilityWeight: MATCH_WEIGHTS.availability,
      fullHours: MATCH_WEIGHTS.fullAvailabilityHours,
    },
  );

  return rows.map((r) => ({
    groupId: r.group_id,
    title: r.title,
    gameId: r.game_id,
    gameTitle: r.game_title,
    gameCoverUrl: r.game_cover_url,
    regionCode: r.region_code,
    ownerDisplayName: r.owner_display_name,
    memberCount: r.member_count,
    maxMembers: r.max_members,
    openSlots: r.open_slots,
    platforms: r.platform_slugs ? r.platform_slugs.split(',') : [],
    score: Number(r.score),
    sameGame: r.same_game === 1,
    sameRegion: r.same_region === 1,
    overlapHours: Number(r.overlap_hours),
  }));
}
