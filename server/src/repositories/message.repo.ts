import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../db/pool.js';
import type { Db } from './user.repo.js';

export interface GroupMessage {
  messageId: number;
  displayName: string;
  body: string;
  createdAt: Date;
}

interface MessageRecord extends RowDataPacket {
  message_id: number;
  display_name: string;
  body: string;
  created_at: Date;
}

function toMessage(row: MessageRecord): GroupMessage {
  return {
    messageId: row.message_id,
    displayName: row.display_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function listMessages(
  groupId: number,
  limit = 50,
  beforeId?: number,
  db: Db = pool,
): Promise<GroupMessage[]> {
  const [rows] = await db.query<MessageRecord[]>(
    `SELECT
       m.message_id,
       p.display_name,
       m.body,
       m.created_at
     FROM message m
     JOIN profile p ON p.user_id = m.user_id
     WHERE m.group_id = :groupId
       AND m.deleted_at IS NULL
       AND (:beforeId IS NULL OR m.message_id < :beforeId)
     ORDER BY m.created_at DESC, m.message_id DESC
     LIMIT :limit`,
    {
      groupId,
      beforeId: beforeId ?? null,
      limit,
    },
  );

  return rows.map(toMessage);
}

export async function insertMessage(
  groupId: number,
  userId: number,
  body: string,
  db: Db = pool,
): Promise<GroupMessage> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO message (group_id, user_id, body)
     VALUES (:groupId, :userId, :body)`,
    {
      groupId,
      userId,
      body,
    },
  );

  const [rows] = await db.query<MessageRecord[]>(
    `SELECT
       m.message_id,
       p.display_name,
       m.body,
       m.created_at
     FROM message m
     JOIN profile p ON p.user_id = m.user_id
     WHERE m.message_id = :messageId`,
    {
      messageId: result.insertId,
    },
  );

  return toMessage(rows[0]!);
}
