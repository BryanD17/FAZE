/**
 * Applies pending migrations in filename order.
 *
 *   npm run db:migrate    apply everything pending
 *   npm run db:status     print applied vs pending and exit (no writes)
 *
 * Guarantees:
 *   - a file is applied at most once (schema_migrations is the record)
 *   - a previously-applied file whose content changed ABORTS the run before
 *     applying anything (anti-pattern C13); the fix is a corrective migration
 *   - each file runs inside a transaction where its statements permit. MySQL
 *     commits implicitly on DDL, so the transaction cannot make a half-applied
 *     CREATE TABLE impossible — what it does give us is atomic recording plus
 *     a clean rollback for the data-only statements (reference-data INSERTs).
 *     Every migration is therefore also written to be idempotent, which is the
 *     real defense.
 */
import { connect, ensureMigrationsTable, getApplied, listMigrations, banner } from './_lib.js';

const statusOnly = process.argv.includes('--status');

async function main() {
  const conn = await connect();
  try {
    await ensureMigrationsTable(conn);
    const applied = await getApplied(conn);
    const all = listMigrations();

    // Integrity check first: never apply anything if history is inconsistent.
    const drifted = all.filter(
      (m) => applied.has(m.filename) && applied.get(m.filename).checksum !== m.checksum,
    );
    if (drifted.length > 0) {
      console.error('\n  CHECKSUM MISMATCH — an already-applied migration was edited.\n');
      for (const m of drifted) {
        console.error(`    ${m.filename}`);
        console.error(`      applied as : ${applied.get(m.filename).checksum}`);
        console.error(`      file is now: ${m.checksum}`);
      }
      console.error(
        '\n  An applied migration is history and cannot be rewritten: other\n' +
          '  databases have already run the old version. Restore the file and\n' +
          '  write a NEW corrective migration instead.\n',
      );
      process.exit(1);
    }

    const pending = all.filter((m) => !applied.has(m.filename));

    if (statusOnly) {
      banner(`Migration status (${process.env.NODE_ENV ?? 'development'})`);
      for (const m of all) {
        const row = applied.get(m.filename);
        console.log(
          row
            ? `  [applied] ${m.filename}  ${new Date(row.applied_at).toISOString()}`
            : `  [pending] ${m.filename}`,
        );
      }
      console.log(`\n  ${applied.size} applied, ${pending.length} pending.\n`);
      return;
    }

    if (pending.length === 0) {
      banner('Migrations');
      console.log(`  Nothing to do — all ${applied.size} migrations are applied.\n`);
      return;
    }

    banner(`Applying ${pending.length} migration(s)`);
    for (const m of pending) {
      const started = Date.now();
      process.stdout.write(`  ${m.filename} ... `);
      await conn.beginTransaction();
      try {
        await conn.query(m.sql);
        await conn.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [
          m.filename,
          m.checksum,
        ]);
        await conn.commit();
        console.log(`applied in ${Date.now() - started}ms`);
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          /* the original error is the useful one */
        }
        console.log('FAILED');
        console.error(`\n  ${m.filename} failed: ${err.message}\n`);
        throw err;
      }
    }
    console.log(`\n  Done. ${applied.size + pending.length} migrations applied in total.\n`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
