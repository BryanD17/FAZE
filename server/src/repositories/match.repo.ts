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
 */
export async function findMatches(
  userId: number,
  limit: number = MATCH_LIMIT,
  db: Db = pool,
): Promise<MatchResult[]> {
  const [rows] = await db.query<MatchRecord[]>(
    `WITH shared AS (
       SELECT gm.group_id,
              SUM(LEAST(mine.end_minute, theirs.end_minute)
                  - GREATEST(mine.start_minute, theirs.start_minute)) AS shared_minutes
         FROM group_member gm
         JOIN v_user_availability_minutes theirs ON theirs.user_id = gm.user_id
         JOIN v_user_availability_minutes mine
           ON mine.user_id = :userId
          AND mine.day_of_week = theirs.day_of_week
          AND mine.start_minute < theirs.end_minute
          AND theirs.start_minute < mine.end_minute
        WHERE gm.state = 'active'
        GROUP BY gm.group_id
     ),
     candidate AS (
       SELECT g.*,
              COALESCE(g.game_id IN (SELECT ug.game_id FROM user_game ug WHERE ug.user_id = :userId), 0)
                AS same_game,
              COALESCE(g.region_id = (SELECT p.region_id FROM profile p WHERE p.user_id = :userId), 0)
                AS same_region,
              COALESCE(s.shared_minutes / 60 / NULLIF(g.member_count, 0), 0) AS overlap_hours
         FROM v_group_card g
         LEFT JOIN shared s ON s.group_id = g.group_id
        WHERE g.visibility = 'open'
          AND g.status = 'recruiting'
          AND g.open_slots > 0
          AND NOT EXISTS (
                SELECT 1 FROM group_member me
                 WHERE me.group_id = g.group_id AND me.user_id = :userId AND me.state = 'active')
     ),
     scored AS (
       SELECT candidate.*,
              :gameWeight * same_game
              + :regionWeight * same_region
              + LEAST(:availabilityWeight,
                      :availabilityWeight * overlap_hours / :fullHours) AS score
         FROM candidate
     )
     SELECT group_id, title, game_id, game_title, game_cover_url, region_code,
            owner_display_name, member_count, max_members, open_slots, platform_slugs,
            ROUND(score) AS score, same_game, same_region, ROUND(overlap_hours, 1) AS overlap_hours
       FROM scored
      WHERE score > 0
      ORDER BY score DESC, last_activity_at DESC, group_id
      LIMIT :limit`,
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
