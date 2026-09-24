/**
 * Development-only: drop the database, recreate it, migrate, and seed.
 *
 *   npm run db:reset
 *
 * This exists so every teammate can get to a known-good state in one command,
 * and so "it works on my machine" has a cheap answer. It destroys data and
 * refuses to run with NODE_ENV=production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  connectServerOnly,
  dbConfig,
  SEEDS_DIR,
  REPO_ROOT,
  assertNotProduction,
  banner,
} from './_lib.js';

assertNotProduction('db:reset');

async function main() {
  banner(`Resetting database \`${dbConfig.database}\``);

  const conn = await connectServerOnly();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbConfig.database}\``);
    await conn.query(
      `CREATE DATABASE \`${dbConfig.database}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    console.log(`  dropped and recreated \`${dbConfig.database}\` (utf8mb4_0900_ai_ci)`);
  } finally {
    await conn.end();
  }

  const migrate = spawnSync(process.execPath, [path.join(REPO_ROOT, 'db/scripts/migrate.js')], {
    stdio: 'inherit',
    env: process.env,
  });
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);

  // Seed scripts are numbered and run in order (AGENT 14 fills this directory).
  const seeds = fs.existsSync(SEEDS_DIR)
    ? fs
        .readdirSync(SEEDS_DIR)
        .filter((f) => f.endsWith('.js'))
        .sort()
    : [];

  if (seeds.length === 0) {
    banner('Seeds');
    console.log('  No seed scripts yet (AGENT 14) — schema and reference data only.\n');
  } else {
    banner(`Running ${seeds.length} seed script(s)`);
    for (const seed of seeds) {
      console.log(`  ${seed}`);
      const result = spawnSync(process.execPath, [path.join(SEEDS_DIR, seed)], {
        stdio: 'inherit',
        env: process.env,
      });
      if (result.status !== 0) {
        console.error(`\n  Seed ${seed} failed.\n`);
        process.exit(result.status ?? 1);
      }
    }
    console.log('');
  }

  console.log(`  Reset complete. \`${dbConfig.database}\` is ready.\n`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
