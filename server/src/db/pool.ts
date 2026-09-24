/**
 * The mysql2 connection pool and the transaction helper.
 *
 * This is the ONLY module that opens a database connection. Repositories take
 * a connection (or default to the pool); nothing above the repository layer
 * imports this file — a route that imports the pool is a defect (convention
 * B.2).
 *
 * Pool options, and why each one is set:
 *   namedPlaceholders  — lets queries use :name parameters, which keeps a
 *                        20-parameter query like the matchmaking search
 *                        readable and removes any temptation to concatenate.
 *   timezone: 'Z'      — the server stores and computes in UTC. Without this,
 *                        mysql2 reinterprets DATETIME values in the process's
 *                        local zone and every availability calculation silently
 *                        shifts by the host's offset.
 *   decimalNumbers     — returns DECIMAL as a JS number rather than a string.
 *   dateStrings: false — we want Date objects; conversion to a viewer's local
 *                        time happens in @faze/shared, once, with tests.
 */
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { config } from '../config.js';

export const pool: Pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  // Tuned against a concurrency measurement in AGENT 16; 10 is the documented
  // starting point and is well inside a free-tier provider's connection cap.
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
  timezone: 'Z',
  decimalNumbers: true,
  charset: 'utf8mb4_0900_ai_ci',
});

/**
 * Runs `fn` inside a single transaction on a dedicated connection.
 *
 * Rule R9: every write that touches more than one table goes through this
 * helper (or through a stored procedure that opens its own transaction). The
 * connection is always released, and any throw rolls the whole unit back, so a
 * half-created group is not representable.
 */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    // Rollback must not mask the original error, so its own failure is
    // swallowed deliberately and the caller still sees the real cause.
    try {
      await conn.rollback();
    } catch {
      /* connection already broken; the original error is the useful one */
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** Liveness check used by `GET /api/health`. Returns false rather than throwing. */
export async function isDatabaseUp(): Promise<boolean> {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false;
  }
}

/** Closes the pool. Used by tests and by graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
