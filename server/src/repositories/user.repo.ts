/**
 * User + profile SQL. The only layer that contains SQL for accounts.
 *
 * Every function takes an optional `db` — the pool by default, or a
 * transaction's connection — so a service can compose several of them into
 * one atomic unit with `withTransaction` (rule R9) without this file knowing.
 * Columns are always named; there is no SELECT *.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';

export type Db = Pool | PoolConnection;
export type AccountStatus = 'pending' | 'active' | 'suspended' | 'deleted';

export interface AuthUserRow {
  userId: number;
  email: string;
  passwordHash: string;
  status: AccountStatus;
  displayName: string;
}

interface AuthUserRecord extends RowDataPacket {
  user_id: number;
  email: string;
  password_hash: string;
  status: AccountStatus;
  display_name: string;
}

const toAuthUser = (r: AuthUserRecord): AuthUserRow => ({
  userId: r.user_id,
  email: r.email,
  passwordHash: r.password_hash,
  status: r.status,
  displayName: r.display_name,
});

export async function findAuthByEmail(email: string, db: Db = pool): Promise<AuthUserRow | null> {
  const [rows] = await db.query<AuthUserRecord[]>(
    `SELECT u.user_id, u.email, u.password_hash, u.status, p.display_name
       FROM \`user\` u
       JOIN profile p ON p.user_id = u.user_id
      WHERE u.email = :email`,
    { email },
  );
  return rows[0] ? toAuthUser(rows[0]) : null;
}

export async function findAuthById(userId: number, db: Db = pool): Promise<AuthUserRow | null> {
  const [rows] = await db.query<AuthUserRecord[]>(
    `SELECT u.user_id, u.email, u.password_hash, u.status, p.display_name
       FROM \`user\` u
       JOIN profile p ON p.user_id = u.user_id
      WHERE u.user_id = :userId`,
    { userId },
  );
  return rows[0] ? toAuthUser(rows[0]) : null;
}

export async function insertUser(
  u: { email: string; passwordHash: string; status: AccountStatus },
  db: Db = pool,
): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO \`user\` (email, password_hash, status)
     VALUES (:email, :passwordHash, :status)`,
    u,
  );
  return res.insertId;
}

export async function insertProfile(
  p: { userId: number; displayName: string },
  db: Db = pool,
): Promise<void> {
  await db.query(`INSERT INTO profile (user_id, display_name) VALUES (:userId, :displayName)`, p);
}

export async function recordSignIn(userId: number, at: Date, db: Db = pool): Promise<void> {
  await db.query(`UPDATE \`user\` SET last_login_at = :at WHERE user_id = :userId`, { userId, at });
}

/** Marks the address verified and activates a pending account; a suspended one stays suspended. */
export async function markEmailVerified(userId: number, at: Date, db: Db = pool): Promise<void> {
  await db.query(
    `UPDATE \`user\`
        SET email_verified_at = :at,
            status = IF(status = 'pending', 'active', status)
      WHERE user_id = :userId`,
    { userId, at },
  );
}

export async function setPasswordHash(
  userId: number,
  passwordHash: string,
  db: Db = pool,
): Promise<void> {
  await db.query(`UPDATE \`user\` SET password_hash = :passwordHash WHERE user_id = :userId`, {
    userId,
    passwordHash,
  });
}

interface ProfileFullRecord extends RowDataPacket {
  user_id: number;
  email: string;
  account_status: AccountStatus;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  birth_year: number | null;
  timezone: string;
  mic_available: number;
  region_code: string | null;
  language_code: string | null;
  platform_slugs: string | null;
  tag_slugs: string | null;
  primary_game_id: number | null;
}

export interface ProfileFull {
  userId: number;
  email: string;
  status: AccountStatus;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  birthYear: number | null;
  timezone: string;
  micAvailable: boolean;
  regionCode: string | null;
  languageCode: string | null;
  platforms: string[];
  tags: string[];
  primaryGameId: number | null;
}

const csv = (v: string | null): string[] => (v ? v.split(',') : []);

/** Reads the caller's own profile through v_user_profile_full (0007). */
export async function findProfileFull(userId: number, db: Db = pool): Promise<ProfileFull | null> {
  const [rows] = await db.query<ProfileFullRecord[]>(
    `SELECT user_id, email, account_status, display_name, bio, avatar_url, birth_year,
            timezone, mic_available, region_code, language_code, platform_slugs,
            tag_slugs, primary_game_id
       FROM v_user_profile_full
      WHERE user_id = :userId`,
    { userId },
  );
  const r = rows[0];
  if (!r) return null;
  return {
    userId: r.user_id,
    email: r.email,
    status: r.account_status,
    displayName: r.display_name,
    bio: r.bio,
    avatarUrl: r.avatar_url,
    birthYear: r.birth_year,
    timezone: r.timezone,
    micAvailable: r.mic_available === 1,
    regionCode: r.region_code,
    languageCode: r.language_code,
    platforms: csv(r.platform_slugs),
    tags: csv(r.tag_slugs),
    primaryGameId: r.primary_game_id,
  };
}
