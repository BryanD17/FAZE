/**
 * ETL stage 10 — stream the raw CSVs into the staging tables.
 *
 * Streaming, not `fs.readFileSync`: games.csv is 33MB today and the Kaggle
 * dumps are 100MB+. Reading one into memory works right up until it does not,
 * on someone else's laptop, the night before a deadline.
 *
 * The parser is configured for the dirt this source actually contains:
 *   - `escape: '\\'`  — fields embed backslash-escaped quotes inside JSON blobs
 *     (price_overview is a serialized object). Without this, the parser splits
 *     a row mid-field and every column after it shifts, which shows up as
 *     nonsense like `type = ' \"currency\": \"EUR\"'` for 75,618 rows. That is
 *     a real bug this pipeline had, caught by sanity-checking the type
 *     distribution against the row count.
 *   - `relax_column_count: true` — a truncated row is rejected with a reason,
 *     not allowed to abort a 140,000-row run.
 *   - `bom: true`, `skip_empty_lines: true`.
 *
 * Staging is reloaded from scratch each run (TRUNCATE first), so the stage is
 * idempotent by construction: same input, same staging contents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import { RAW_DIR, runStage, cleanText } from './_etl_lib.js';

const BATCH_SIZE = 1000;
const LOG_EVERY = 10000;

/** Streams `file`, batching rows through `mapRow` into `table`. */
async function loadCsv(conn, run, { file, table, columns, mapRow, label }) {
  const fullPath = path.join(RAW_DIR, file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`${file} is missing from db/data/raw. Run: npm run etl:download`);
  }

  await conn.query(`TRUNCATE TABLE ${table}`);

  const parser = fs.createReadStream(fullPath).pipe(
    parse({
      columns: true,
      escape: '\\',
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
    }),
  );

  let batch = [];
  let seen = 0;
  let loaded = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    // ON DUPLICATE KEY UPDATE rather than INSERT IGNORE: a duplicate appid in
    // the source should refresh the row, and IGNORE would also swallow genuine
    // errors (bad types, truncated data) that we want to see.
    const assignments = columns.map((c) => `${c} = VALUES(${c})`).join(', ');
    await conn.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ? ON DUPLICATE KEY UPDATE ${assignments}`,
      [batch],
    );
    loaded += batch.length;
    batch = [];
  };

  for await (const record of parser) {
    seen++;
    const mapped = mapRow(record, run);
    if (mapped === null) continue; // mapRow already logged the reject
    batch.push(mapped);
    if (batch.length >= BATCH_SIZE) await flush();
    if (seen % LOG_EVERY === 0) console.log(`    ${label}: ${seen} rows read`);
  }
  await flush();

  console.log(`    ${label}: ${seen} read, ${loaded} staged`);
  run.rowsIn += seen;
  run.rowsLoaded += loaded;
}

/** Steam app ids are positive integers; anything else is unusable as a key. */
function parseAppId(value) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

await runStage('steam_csv', async (conn, run) => {
  // --- games -----------------------------------------------------------------
  await loadCsv(conn, run, {
    file: 'games.csv',
    table: 'stg_steam_game',
    label: 'games',
    columns: ['steam_appid', 'name', 'release_date', 'app_type', 'is_free', 'languages'],
    mapRow: (r, run) => {
      const appId = parseAppId(r.app_id);
      if (appId === null) {
        run.reject(r.app_id, 'unparseable app_id', r);
        return null;
      }
      const name = cleanText(r.name);
      if (name === null) {
        // A game with no title cannot be searched for, displayed, or slugged.
        run.reject(appId, 'missing name', r);
        return null;
      }
      return [
        appId,
        name.slice(0, 1000),
        cleanText(r.release_date),
        cleanText(r.type),
        cleanText(r.is_free),
        cleanText(r.languages)?.slice(0, 5000) ?? null,
      ];
    },
  });

  // --- genres ----------------------------------------------------------------
  await loadCsv(conn, run, {
    file: 'genres.csv',
    table: 'stg_steam_genre',
    label: 'genres',
    columns: ['steam_appid', 'genre'],
    mapRow: (r, run) => {
      const appId = parseAppId(r.app_id);
      if (appId === null) {
        run.reject(r.app_id, 'unparseable app_id in genres', r);
        return null;
      }
      const genre = cleanText(r.genre);
      if (genre === null) {
        run.reject(appId, 'empty genre value', r);
        return null;
      }
      return [appId, genre.slice(0, 255)];
    },
  });

  // --- categories ------------------------------------------------------------
  await loadCsv(conn, run, {
    file: 'categories.csv',
    table: 'stg_steam_category',
    label: 'categories',
    columns: ['steam_appid', 'category'],
    mapRow: (r, run) => {
      const appId = parseAppId(r.app_id);
      if (appId === null) {
        run.reject(r.app_id, 'unparseable app_id in categories', r);
        return null;
      }
      const category = cleanText(r.category);
      if (category === null) {
        run.reject(appId, 'empty category value', r);
        return null;
      }
      return [appId, category.slice(0, 255)];
    },
  });

  // --- SteamSpy insights, merged onto the staged app rows --------------------
  // These arrive in a separate file keyed on the same app_id, so they update
  // stg_steam_game rather than landing in a table of their own.
  const spyPath = path.join(RAW_DIR, 'steamspy_insights.csv');
  if (fs.existsSync(spyPath)) {
    const parser = fs.createReadStream(spyPath).pipe(
      parse({
        columns: true,
        escape: '\\',
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
      }),
    );
    let batch = [];
    let seen = 0;
    let updated = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      // Only touches rows that already exist: a SteamSpy row for an app that
      // failed games.csv validation must not resurrect it.
      await conn.query(
        `INSERT INTO stg_steam_game (steam_appid, developer, publisher, owners_range, concurrent_users)
         VALUES ?
         ON DUPLICATE KEY UPDATE developer = VALUES(developer), publisher = VALUES(publisher),
           owners_range = VALUES(owners_range), concurrent_users = VALUES(concurrent_users)`,
        [batch],
      );
      updated += batch.length;
      batch = [];
    };
    for await (const r of parser) {
      seen++;
      const appId = parseAppId(r.app_id);
      if (appId === null) {
        run.reject(r.app_id, 'unparseable app_id in steamspy', r);
        continue;
      }
      batch.push([
        appId,
        cleanText(r.developer)?.slice(0, 500) ?? null,
        cleanText(r.publisher)?.slice(0, 500) ?? null,
        cleanText(r.owners_range),
        cleanText(r.concurrent_users),
      ]);
      if (batch.length >= BATCH_SIZE) await flush();
      if (seen % LOG_EVERY === 0) console.log(`    steamspy: ${seen} rows read`);
    }
    await flush();
    console.log(`    steamspy: ${seen} read, ${updated} merged`);
    run.rowsIn += seen;
  } else {
    console.log('    steamspy_insights.csv not present — skipping owner data.');
  }

  return 'Loaded games, genres, categories and SteamSpy insights into staging.';
});
