import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../db/pool.js';
import type { Db } from './user.repo.js';

export interface ProfileRow {
  userId: number;
  email: string;
  status: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  birthYear: number | null;
  regionId: number | null;
  regionCode: string | null;
  languageId: number | null;
  languageCode: string | null;
  timezone: string;
  micAvailable: boolean;
  platforms: string[];
  tags: string[];
  primaryGameId: number | null;
}

interface ProfileRecord extends RowDataPacket {
  user_id: number;
  email: string;
  account_status: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  birth_year: number | null;
  region_id: number | null;
  region_code: string | null;
  language_id: number | null;
  language_code: string | null;
  timezone: string;
  mic_available: number;
  platform_slugs: string | null;
  tag_slugs: string | null;
  primary_game_id: number | null;
}

const csv = (value: string | null): string[] => (value ? value.split(',') : []);

function mapProfile(r: ProfileRecord): ProfileRow {
  return {
    userId: r.user_id,
    email: r.email,
    status: r.account_status,
    displayName: r.display_name,
    bio: r.bio,
    avatarUrl: r.avatar_url,
    birthYear: r.birth_year,
    regionId: r.region_id,
    regionCode: r.region_code,
    languageId: r.language_id,
    languageCode: r.language_code,
    timezone: r.timezone,
    micAvailable: r.mic_available === 1,
    platforms: csv(r.platform_slugs),
    tags: csv(r.tag_slugs),
    primaryGameId: r.primary_game_id,
  };
}

export async function getProfile(userId: number, db: Db = pool): Promise<ProfileRow | null> {
  const [rows] = await db.query<ProfileRecord[]>(
    `SELECT user_id, email, account_status, display_name, bio, avatar_url,
            birth_year, region_id, region_code, language_id, language_code,
            timezone, mic_available, platform_slugs, tag_slugs, primary_game_id
       FROM v_user_profile_full
      WHERE user_id = :userId`,
    { userId },
  );

  return rows[0] ? mapProfile(rows[0]) : null;
}

export async function getProfileByDisplayName(
  displayName: string,
  db: Db = pool,
): Promise<ProfileRow | null> {
  const [rows] = await db.query<ProfileRecord[]>(
    `SELECT user_id, email, account_status, display_name, bio, avatar_url,
            birth_year, region_id, region_code, language_id, language_code,
            timezone, mic_available, platform_slugs, tag_slugs, primary_game_id
       FROM v_user_profile_full
      WHERE display_name = :displayName`,
    { displayName },
  );

  return rows[0] ? mapProfile(rows[0]) : null;
}

export async function patchProfile(
  userId: number,
  patch: Record<string, unknown>,
  db: Db = pool,
): Promise<void> {
  const columns: Record<string, string> = {
    displayName: 'display_name',
    bio: 'bio',
    avatarUrl: 'avatar_url',
    birthYear: 'birth_year',
    regionId: 'region_id',
    languageId: 'language_id',
    timezone: 'timezone',
    micAvailable: 'mic_available',
  };

  const entries = Object.entries(patch).filter(([key]) => columns[key] !== undefined);

  if (entries.length === 0) return;

  const set = entries.map(([key]) => `${columns[key]} = :${key}`).join(', ');

  await db.query(`UPDATE profile SET ${set} WHERE user_id = :userId`, { ...patch, userId });
}

async function existingIdCount(
  table: 'platform' | 'playstyle_tag',
  column: 'platform_id' | 'tag_id',
  ids: number[],
  db: Db,
): Promise<number> {
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM ${table}
      WHERE ${column} IN (${placeholders})`,
    ids,
  );

  return Number(rows[0]?.count ?? 0);
}

export async function replacePlatforms(
  userId: number,
  platformIds: number[],
  conn: PoolConnection,
): Promise<void> {
  const count = await existingIdCount('platform', 'platform_id', platformIds, conn);

  if (count !== platformIds.length) {
    throw new Error('UNKNOWN_PLATFORM');
  }

  await conn.query('DELETE FROM user_platform WHERE user_id = ?', [userId]);

  for (const platformId of platformIds) {
    await conn.query(
      `INSERT INTO user_platform (user_id, platform_id)
       VALUES (?, ?)`,
      [userId, platformId],
    );
  }
}

export async function replaceTags(
  userId: number,
  tagIds: number[],
  conn: PoolConnection,
): Promise<void> {
  const count = await existingIdCount('playstyle_tag', 'tag_id', tagIds, conn);

  if (count !== tagIds.length) {
    throw new Error('UNKNOWN_TAG');
  }

  await conn.query('DELETE FROM user_tag WHERE user_id = ?', [userId]);

  for (const tagId of tagIds) {
    await conn.query(
      `INSERT INTO user_tag (user_id, tag_id)
       VALUES (?, ?)`,
      [userId, tagId],
    );
  }
}

export interface StoredAvailability {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface AvailabilityRecord extends RowDataPacket {
  day_of_week: number;
  start_minute: number;
  end_minute: number;
}

export async function replaceAvailability(
  userId: number,
  slots: StoredAvailability[],
  conn: PoolConnection,
): Promise<void> {
  await conn.query('DELETE FROM availability_slot WHERE user_id = ?', [userId]);

  for (const slot of slots) {
    await conn.query(
      `INSERT INTO availability_slot
         (user_id, day_of_week, start_minute, end_minute)
       VALUES (?, ?, ?, ?)`,
      [userId, slot.dayOfWeek, slot.startMinute, slot.endMinute],
    );
  }
}

export async function getAvailability(
  userId: number,
  db: Db = pool,
): Promise<StoredAvailability[]> {
  const [rows] = await db.query<AvailabilityRecord[]>(
    `SELECT day_of_week, start_minute, end_minute
       FROM availability_slot
      WHERE user_id = :userId
      ORDER BY day_of_week, start_minute`,
    { userId },
  );

  return rows.map((r) => ({
    dayOfWeek: r.day_of_week,
    startMinute: r.start_minute,
    endMinute: r.end_minute,
  }));
}

export async function sharesActiveGroup(
  firstUserId: number,
  secondUserId: number,
  db: Db = pool,
): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 AS shared
       FROM group_member a
       JOIN group_member b
         ON b.group_id = a.group_id
        AND b.user_id = :secondUserId
        AND b.state = 'active'
      WHERE a.user_id = :firstUserId
        AND a.state = 'active'
      LIMIT 1`,
    { firstUserId, secondUserId },
  );

  return rows.length > 0;
}

export interface CompletenessCounts {
  platforms: number;
  games: number;
  region: number;
  availability: number;
  tags: number;
}

export async function getCompletenessCounts(
  userId: number,
  db: Db = pool,
): Promise<CompletenessCounts> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM user_platform WHERE user_id = :userId) AS platforms,
       (SELECT COUNT(*) FROM user_game WHERE user_id = :userId) AS games,
       (SELECT COUNT(*) FROM profile
         WHERE user_id = :userId AND region_id IS NOT NULL) AS region,
       (SELECT COUNT(*) FROM availability_slot WHERE user_id = :userId) AS availability,
       (SELECT COUNT(*) FROM user_tag WHERE user_id = :userId) AS tags`,
    { userId },
  );

  const row = rows[0]!;

  return {
    platforms: Number(row.platforms),
    games: Number(row.games),
    region: Number(row.region),
    availability: Number(row.availability),
    tags: Number(row.tags),
  };
}

export async function userGameCount(userId: number, db: Db = pool): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS count FROM user_game WHERE user_id = :userId',
    { userId },
  );

  return Number(rows[0]?.count ?? 0);
}

export async function hasUserGame(userId: number, gameId: number, db: Db = pool): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM user_game
      WHERE user_id = :userId AND game_id = :gameId`,
    { userId, gameId },
  );

  return rows.length > 0;
}

export async function upsertUserGame(
  userId: number,
  input: {
    gameId: number;
    selfRank: string | null;
    rankTier: number | null;
    hoursPlayed: number | null;
    goal: string;
  },
  db: Db = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO user_game
       (user_id, game_id, self_rank, rank_tier, hours_played, goal,
        is_primary, primary_owner_id)
     VALUES (:userId, :gameId, :selfRank, :rankTier, :hoursPlayed, :goal, 0, NULL)
     ON DUPLICATE KEY UPDATE
       self_rank = VALUES(self_rank),
       rank_tier = VALUES(rank_tier),
       hours_played = VALUES(hours_played),
       goal = VALUES(goal)`,
    { userId, ...input },
  );
}

export async function patchUserGame(
  userId: number,
  gameId: number,
  patch: Record<string, unknown>,
  db: Db = pool,
): Promise<void> {
  const columns: Record<string, string> = {
    selfRank: 'self_rank',
    rankTier: 'rank_tier',
    hoursPlayed: 'hours_played',
    goal: 'goal',
  };

  const entries = Object.entries(patch).filter(([key]) => columns[key] !== undefined);

  if (entries.length === 0) return;

  const set = entries.map(([key]) => `${columns[key]} = :${key}`).join(', ');

  await db.query(
    `UPDATE user_game
        SET ${set}
      WHERE user_id = :userId AND game_id = :gameId`,
    { ...patch, userId, gameId },
  );
}

export async function clearPrimaryGame(
  userId: number,
  gameId: number,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE user_game
        SET is_primary = 0,
            primary_owner_id = NULL
      WHERE user_id = :userId
        AND game_id = :gameId`,
    { userId, gameId },
  );
}

export async function setPrimaryGame(userId: number, gameId: number, db: Db = pool): Promise<void> {
  await db.query('CALL sp_set_primary_game(:userId, :gameId, @result)', { userId, gameId });

  const [rows] = await db.query<RowDataPacket[]>('SELECT @result AS result');

  if (rows[0]?.result !== 'PRIMARY_SET') {
    throw new Error('GAME_NOT_FOUND');
  }
}

export async function deleteUserGame(
  userId: number,
  gameId: number,
  db: Db = pool,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `DELETE FROM user_game
      WHERE user_id = :userId AND game_id = :gameId`,
    { userId, gameId },
  );

  return result.affectedRows;
}
