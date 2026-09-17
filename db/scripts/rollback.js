/**
 * Rolls back the most recently applied migration by running its paired
 * `NNNN_*.down.sql`, then deleting the schema_migrations row.
 *
 *   npm run db:rollback           roll back one migration
 *   npm run db:rollback -- 3      roll back the last three, newest first
 *
 * Refuses to run against NODE_ENV=production.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  connect,
  ensureMigrationsTable,
  MIGRATIONS_DIR,
  assertNotProduction,
  banner,
} from './_lib.js';

assertNotProduction('db:rollback');

const steps = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 1);

async function main() {
  const conn = await connect();
  try {
    await ensureMigrationsTable(conn);
    const [rows] = await conn.query(
      'SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT ?',
      [steps],
    );

    if (rows.length === 0) {
      banner('Rollback');
      console.log('  Nothing to roll back — no migrations are applied.\n');
      return;
    }

    banner(`Rolling back ${rows.length} migration(s)`);
    for (const { filename } of rows) {
      const downFile = filename.replace(/\.sql$/, '.down.sql');
      const downPath = path.join(MIGRATIONS_DIR, downFile);
      if (!fs.existsSync(downPath)) {
        // Every migration is required to ship its own reversal. A missing one
        // is a defect in that migration's PR, not something to route around.
        console.error(`\n  ${downFile} is missing — cannot roll back ${filename}.\n`);
        process.exit(1);
      }
      process.stdout.write(`  ${downFile} ... `);
      await conn.beginTransaction();
      try {
        await conn.query(fs.readFileSync(downPath, 'utf8'));
        await conn.query('DELETE FROM schema_migrations WHERE filename = ?', [filename]);
        await conn.commit();
        console.log('rolled back');
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          /* the original error is the useful one */
        }
        console.log('FAILED');
        throw err;
      }
    }
    console.log('');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
