/**
 * Group membership lookup used by requireGroupRole. Read-only; every
 * membership WRITE goes through the stored procedures (0008).
 */
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import type { Db } from './user.repo.js';

export type GroupRole = 'owner' | 'moderator' | 'member';

interface RoleRecord extends RowDataPacket {
  role: GroupRole;
}

/** The caller's role in a group, or null unless they are an ACTIVE member. PK lookup. */
export async function findActiveRole(
  groupId: number,
  userId: number,
  db: Db = pool,
): Promise<GroupRole | null> {
  const [rows] = await db.query<RoleRecord[]>(
    `SELECT role FROM group_member
      WHERE group_id = :groupId AND user_id = :userId AND state = 'active'`,
    { groupId, userId },
  );
  return rows[0]?.role ?? null;
}
