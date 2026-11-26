import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../db/pool.js';
import type { Db } from './user.repo.js';

export type SessionState = 'scheduled' | 'played' | 'cancelled';

export interface PlaySession {
  sessionId: number;
  groupId: number;
  startsAt: Date;
  state: SessionState;
  createdAt: Date;
}

interface SessionRecord extends RowDataPacket {
  session_id: number;
  group_id: number;
  starts_at: Date;
  state: SessionState;
  created_at: Date;
}

function toSession(row: SessionRecord): PlaySession {
  return {
    sessionId: row.session_id,
    groupId: row.group_id,
    startsAt: row.starts_at,
    state: row.state,
    createdAt: row.created_at,
  };
}

/** Schedule a simple two-hour session. Phase 2 intentionally has no duration UI or recurrence. */
export async function insertSession(
  groupId: number,
  startsAt: Date,
  db: Db = pool,
): Promise<PlaySession> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO play_session (group_id, starts_at, duration_minutes)
     VALUES (:groupId, :startsAt, 120)`,
    { groupId, startsAt },
  );
  const session = await findSession(result.insertId, db);
  if (!session) throw new Error('Created session could not be read back.');
  return session;
}

/** Sessions for one group, newest scheduled time first. */
export async function listSessions(groupId: number, db: Db = pool): Promise<PlaySession[]> {
  const [rows] = await db.query<SessionRecord[]>(
    `SELECT session_id, group_id, starts_at, state, created_at
       FROM play_session
      WHERE group_id = :groupId
      ORDER BY starts_at DESC, session_id DESC`,
    { groupId },
  );
  return rows.map(toSession);
}

export async function findSession(sessionId: number, db: Db = pool): Promise<PlaySession | null> {
  const [rows] = await db.query<SessionRecord[]>(
    `SELECT session_id, group_id, starts_at, state, created_at
       FROM play_session
      WHERE session_id = :sessionId`,
    { sessionId },
  );
  return rows[0] ? toSession(rows[0]) : null;
}

/** Existing stored procedure owns the played-state transition. */
export async function markSessionPlayed(sessionId: number): Promise<void> {
  await pool.query('CALL sp_record_session_played(?)', [sessionId]);
}

/** The existing rating trigger decides whether this pair may rate this session. */
export async function insertRating(
  sessionId: number,
  raterUserId: number,
  rateeUserId: number,
  score: number,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO rating (rater_user_id, ratee_user_id, session_id, score)
     VALUES (:raterUserId, :rateeUserId, :sessionId, :score)`,
    { raterUserId, rateeUserId, sessionId, score },
  );
}
