/**
 * Shared plumbing for the migration CLIs.
 *
 * These scripts are plain Node (not TypeScript) on purpose: they must run
 * before anything is built, in CI, and on a teammate's machine that has only
 * done `npm install`. Nothing here imports from server/ — the runner has to
 * work even when the application does not compile.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../..');
export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'db', 'migrations');
export const SEEDS_DIR = path.join(REPO_ROOT, 'db', 'seeds');

loadDotenv({ path: path.join(REPO_ROOT, '.env') });

export const dbConfig = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database:
    process.env.NODE_ENV === 'test'
      ? (process.env.DB_NAME_TEST ?? 'faze_test')
      : (process.env.DB_NAME ?? 'faze'),
};

/**
 * Opens a connection with `multipleStatements` enabled.
 *
 * Migration files legitimately contain many statements, and stored procedure
 * bodies contain semicolons that a naive split would cut in half. Letting the
 * server parse the file is both safer and simpler than parsing SQL in JS.
 * This is the ONLY place multipleStatements is ever true — application
 * queries are single, parameterized statements.
 */
export async function connect({ database = dbConfig.database } = {}) {
  return mysql.createConnection({
    ...dbConfig,
    database,
    multipleStatements: true,
    // DDL is not affected by the session timezone, but keeping the runner
    // consistent with the application pool avoids surprises in seed data.
    timezone: 'Z',
  });
}

/** Connects with no database selected — for CREATE/DROP DATABASE in reset.js. */
export async function connectServerOnly() {
  return mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    multipleStatements: true,
  });
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Lists the forward migrations in filename order.
 *
 * `.down.sql` files are paired rollbacks, not migrations, so they are excluded
 * here. Ordering is lexicographic over a fixed 4-digit prefix, which is why
 * the prefix must never be reused or reordered.
 */
export function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort()
    .map((filename) => {
      const fullPath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(fullPath, 'utf8');
      return { filename, fullPath, sql, checksum: sha256(sql) };
    });
}

/**
 * Creates the bookkeeping table if absent.
 *
 * `checksum` is what makes anti-pattern C13 (editing an applied migration)
 * detectable instead of a mystery three weeks later: if a file's sha256 no
 * longer matches what was applied, somebody's database and somebody's repo
 * disagree about what the schema is.
 */
export async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) NOT NULL,
      checksum   CHAR(64)     NOT NULL,
      applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      COMMENT='Applied migrations. checksum guards against editing an applied file.'
  `);
}

export async function getApplied(conn) {
  const [rows] = await conn.query(
    'SELECT filename, checksum, applied_at FROM schema_migrations ORDER BY filename',
  );
  return new Map(rows.map((r) => [r.filename, r]));
}

/** Refuses to touch a production database from a development-only CLI. */
export function assertNotProduction(command) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      `\n  Refusing to run \`${command}\` with NODE_ENV=production.\n` +
        '  This command destroys data. If you genuinely need it against a\n' +
        '  production database, do it by hand, with a dump taken first.\n',
    );
    process.exit(1);
  }
}

export function banner(title) {
  console.log(`\n  ${title}`);
  console.log(`  ${'-'.repeat(title.length)}`);
}
