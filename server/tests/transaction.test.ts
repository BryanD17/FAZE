/**
 * Proves the guarantee rule R9 depends on: withTransaction rolls back
 * everything when the callback throws.
 *
 * This is not a test of mysql2 — it is a test that OUR helper commits on
 * success, rolls back on throw, and releases the connection either way. Every
 * multi-table write in FAZE inherits this behaviour, so if it is wrong, a
 * half-created group is representable and the schema's guarantees are a
 * fiction.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, withTransaction, closePool } from '../src/db/pool.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const EMAIL_OK = 'txn-commit@faze.test';
const EMAIL_ROLLED_BACK = 'txn-rollback@faze.test';

async function countUsers(email: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM `user` WHERE email = ?',
    [email],
  );
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  await pool.query('DELETE FROM `user` WHERE email IN (?, ?)', [EMAIL_OK, EMAIL_ROLLED_BACK]);
});

afterAll(async () => {
  await pool.query('DELETE FROM `user` WHERE email IN (?, ?)', [EMAIL_OK, EMAIL_ROLLED_BACK]);
  await closePool();
});

describe('withTransaction', () => {
  it('commits every statement when the callback returns', async () => {
    const userId = await withTransaction(async (conn) => {
      const [res] = await conn.query<ResultSetHeader>(
        "INSERT INTO `user` (email, password_hash, status) VALUES (?, 'x', 'active')",
        [EMAIL_OK],
      );
      // A second write in the same unit: a profile row keyed to the new user.
      await conn.query('INSERT INTO profile (user_id, display_name) VALUES (?, ?)', [
        res.insertId,
        `txn_commit_${res.insertId}`,
      ]);
      return res.insertId;
    });

    expect(await countUsers(EMAIL_OK)).toBe(1);
    const [profiles] = await pool.query<RowDataPacket[]>(
      'SELECT user_id FROM profile WHERE user_id = ?',
      [userId],
    );
    expect(profiles).toHaveLength(1);
  });

  it('rolls the whole unit back when the callback throws', async () => {
    const boom = new Error('deliberate failure after the insert');

    await expect(
      withTransaction(async (conn) => {
        await conn.query(
          "INSERT INTO `user` (email, password_hash, status) VALUES (?, 'x', 'active')",
          [EMAIL_ROLLED_BACK],
        );
        // The row exists inside this transaction...
        const [inside] = await conn.query<RowDataPacket[]>(
          'SELECT COUNT(*) AS n FROM `user` WHERE email = ?',
          [EMAIL_ROLLED_BACK],
        );
        expect(Number(inside[0]?.n)).toBe(1);
        throw boom;
      }),
    ).rejects.toThrow(boom);

    // ...and is gone once the throw unwound the transaction.
    expect(await countUsers(EMAIL_ROLLED_BACK)).toBe(0);
  });

  it('releases the connection on both paths, so the pool is not exhausted', async () => {
    // connectionLimit is 10; twenty sequential failures would hang forever if
    // the finally block were missing.
    for (let i = 0; i < 20; i++) {
      await expect(
        withTransaction(async () => {
          throw new Error(`failure ${i}`);
        }),
      ).rejects.toThrow();
    }
    const [rows] = await pool.query<RowDataPacket[]>('SELECT 1 AS ok');
    expect(rows[0]?.ok).toBe(1);
  });
});
