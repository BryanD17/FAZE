/**
 * SQL for the three token tables (0011): refresh_token, email_verification,
 * password_reset. Only ever handles SHA-256 hashes, never a raw token.
 *
 * The `lock*` functions use SELECT ... FOR UPDATE. Rotation and single-use
 * are check-then-act decisions ("is this token still valid? then spend it"),
 * and without the row lock two concurrent requests could both pass the check
 * and both spend the token — the same race sp_join_group closes for capacity.
 */
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import type { Db } from './user.repo.js';

export interface RefreshTokenRow {
  tokenHash: string;
  userId: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface OneShotTokenRow {
  tokenHash: string;
  userId: number;
  expiresAt: Date;
  usedAt: Date | null;
}

interface RefreshRecord extends RowDataPacket {
  token_hash: string;
  user_id: number;
  expires_at: Date;
  revoked_at: Date | null;
}
interface OneShotRecord extends RowDataPacket {
  token_hash: string;
  user_id: number;
  expires_at: Date;
  used_at: Date | null;
}

// ---- refresh tokens ---------------------------------------------------------

export async function insertRefreshToken(
  t: { tokenHash: string; userId: number; expiresAt: Date; userAgent: string | null },
  db: Db = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO refresh_token (token_hash, user_id, expires_at, user_agent)
     VALUES (:tokenHash, :userId, :expiresAt, :userAgent)`,
    t,
  );
}

export async function lockRefreshToken(
  tokenHash: string,
  db: Db = pool,
): Promise<RefreshTokenRow | null> {
  const [rows] = await db.query<RefreshRecord[]>(
    `SELECT token_hash, user_id, expires_at, revoked_at
       FROM refresh_token
      WHERE token_hash = :tokenHash
        FOR UPDATE`,
    { tokenHash },
  );
  const r = rows[0];
  return r
    ? {
        tokenHash: r.token_hash,
        userId: r.user_id,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
      }
    : null;
}

export async function revokeRefreshToken(
  tokenHash: string,
  at: Date,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE refresh_token SET revoked_at = :at WHERE token_hash = :tokenHash AND revoked_at IS NULL`,
    { tokenHash, at },
  );
}

/** Serves idx_refresh_token_user_revoked (user_id, revoked_at). */
export async function revokeAllRefreshTokensForUser(
  userId: number,
  at: Date,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE refresh_token SET revoked_at = :at WHERE user_id = :userId AND revoked_at IS NULL`,
    { userId, at },
  );
}

// ---- email verification -----------------------------------------------------

export async function insertEmailVerification(
  t: { tokenHash: string; userId: number; expiresAt: Date },
  db: Db = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO email_verification (token_hash, user_id, expires_at)
     VALUES (:tokenHash, :userId, :expiresAt)`,
    t,
  );
}

export async function lockEmailVerification(
  tokenHash: string,
  db: Db = pool,
): Promise<OneShotTokenRow | null> {
  const [rows] = await db.query<OneShotRecord[]>(
    `SELECT token_hash, user_id, expires_at, used_at
       FROM email_verification
      WHERE token_hash = :tokenHash
        FOR UPDATE`,
    { tokenHash },
  );
  const r = rows[0];
  return r
    ? { tokenHash: r.token_hash, userId: r.user_id, expiresAt: r.expires_at, usedAt: r.used_at }
    : null;
}

export async function markEmailVerificationUsed(
  tokenHash: string,
  at: Date,
  db: Db = pool,
): Promise<void> {
  await db.query(`UPDATE email_verification SET used_at = :at WHERE token_hash = :tokenHash`, {
    tokenHash,
    at,
  });
}

// ---- password reset ---------------------------------------------------------

export async function insertPasswordReset(
  t: { tokenHash: string; userId: number; expiresAt: Date },
  db: Db = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO password_reset (token_hash, user_id, expires_at)
     VALUES (:tokenHash, :userId, :expiresAt)`,
    t,
  );
}

/** Requesting a new reset link retires any older, still-unused one. */
export async function retireUnusedPasswordResets(
  userId: number,
  at: Date,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE password_reset SET used_at = :at WHERE user_id = :userId AND used_at IS NULL`,
    { userId, at },
  );
}

export async function lockPasswordReset(
  tokenHash: string,
  db: Db = pool,
): Promise<OneShotTokenRow | null> {
  const [rows] = await db.query<OneShotRecord[]>(
    `SELECT token_hash, user_id, expires_at, used_at
       FROM password_reset
      WHERE token_hash = :tokenHash
        FOR UPDATE`,
    { tokenHash },
  );
  const r = rows[0];
  return r
    ? { tokenHash: r.token_hash, userId: r.user_id, expiresAt: r.expires_at, usedAt: r.used_at }
    : null;
}
