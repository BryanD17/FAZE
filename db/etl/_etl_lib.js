/**
 * Shared ETL helpers: run bookkeeping and reject capture.
 *
 * Every stage opens an `etl_run` row, reports rows_in / rows_loaded /
 * rows_rejected, and closes it as success or failed. A stage that throws still
 * closes its row as 'failed' so a crashed run is visible in the audit rather
 * than looking like it never happened.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../..');
export const RAW_DIR = path.join(REPO_ROOT, 'db', 'data', 'raw');
export const CACHE_DIR = path.join(REPO_ROOT, 'db', 'data', 'cache');

loadDotenv({ path: path.join(REPO_ROOT, '.env') });

export async function connect() {
  return mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? 'root',
    database:
      process.env.NODE_ENV === 'test'
        ? (process.env.DB_NAME_TEST ?? 'faze_test')
        : (process.env.DB_NAME ?? 'faze'),
    timezone: 'Z',
  });
}

/** Opens an etl_run row and returns a handle that closes it exactly once. */
export async function startRun(conn, source) {
  const [res] = await conn.query('INSERT INTO etl_run (source, status) VALUES (?, ?)', [
    source,
    'running',
  ]);
  const runId = res.insertId;
  const rejects = [];
  const warnings = [];
  let closed = false;

  return {
    runId,
    rowsIn: 0,
    rowsLoaded: 0,

    /**
     * Queues a REJECTED ROW — one that was not promoted at all. These are what
     * `rows_rejected` counts, so `rows_in = rows_loaded + rows_rejected` always
     * reconciles.
     */
    reject(naturalKey, reason, rawRow) {
      rejects.push([
        runId,
        naturalKey == null ? null : String(naturalKey).slice(0, 120),
        reason.slice(0, 300),
        rawRow === undefined ? null : JSON.stringify(rawRow),
      ]);
    },

    /**
     * Queues a FIELD-LEVEL finding on a row that WAS loaded — an unparseable
     * release date, say, where the row is still useful with that column NULL.
     *
     * These land in etl_reject too (a silent drop of any kind is a bug), but
     * with a `field:` reason prefix and WITHOUT counting toward rows_rejected,
     * so the run's arithmetic still reconciles. The taxonomy query
     * `GROUP BY reason` separates the two classes by that prefix.
     */
    warn(naturalKey, reason, rawRow) {
      warnings.push([
        runId,
        naturalKey == null ? null : String(naturalKey).slice(0, 120),
        `field: ${reason}`.slice(0, 300),
        rawRow === undefined ? null : JSON.stringify(rawRow),
      ]);
    },

    get rejectCount() {
      return rejects.length;
    },

    get warnCount() {
      return warnings.length;
    },

    async finish(status, notes) {
      if (closed) return;
      closed = true;
      const all = rejects.concat(warnings);
      if (all.length > 0) {
        for (let i = 0; i < all.length; i += 1000) {
          const chunk = all.slice(i, i + 1000);
          await conn.query(
            'INSERT INTO etl_reject (run_id, natural_key, reason, raw_row) VALUES ?',
            [chunk],
          );
        }
      }
      await conn.query(
        `UPDATE etl_run
            SET rows_in = ?, rows_loaded = ?, rows_rejected = ?,
                finished_at = NOW(), status = ?, notes = ?
          WHERE run_id = ?`,
        [this.rowsIn, this.rowsLoaded, rejects.length, status, notes ?? null, runId],
      );
    },
  };
}

/**
 * Wraps a stage so the etl_run row is always closed and a failure exits
 * non-zero — `npm run etl:all` must fail loudly, not continue past a broken
 * stage (task 7).
 */
export async function runStage(source, fn) {
  const conn = await connect();
  const run = await startRun(conn, source);
  const started = Date.now();
  try {
    const notes = await fn(conn, run);
    await run.finish('success', notes);
    console.log(
      `  [${source}] success — in ${run.rowsIn}, loaded ${run.rowsLoaded}, ` +
        `rejected ${run.rejectCount}, field-warnings ${run.warnCount} ` +
        `(${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  } catch (err) {
    await run.finish('failed', err.message?.slice(0, 1000));
    console.error(`  [${source}] FAILED: ${err.message}`);
    await conn.end();
    process.exit(1);
  }
  await conn.end();
}

/**
 * A URL-safe slug. Deterministic, because it is the catalog's de-duplication
 * key — the same title must always produce the same slug on every machine.
 */
export function slugify(title) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/['’]/g, '') // don't turn "Assassin's" into "assassin-s"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);
}

/** Collapses whitespace and trims. Returns null for an effectively empty value. */
export function cleanText(value) {
  if (value == null) return null;
  const t = String(value).replace(/\s+/g, ' ').trim();
  return t.length === 0 ? null : t;
}
