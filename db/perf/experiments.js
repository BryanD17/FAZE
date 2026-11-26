/**
 * Phase 2 experiments: the baselines and the scaling runs in docs/experiments.md.
 *
 *   npm run build --workspace=@faze/server   # the match query is imported from the build
 *   node db/perf/experiments.js
 *
 * Needs the game catalog in the `faze` database (npm run etl:all). For each size
 * it drops and rebuilds the throwaway `faze_perf` database with db/perf/load.sql,
 * then times each query (median of 5 runs, after one warm-up run). It prints the
 * Markdown tables for docs/experiments.md and writes the two charts to docs/img/.
 * The last size is kept for the baselines.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import mysql from 'mysql2/promise';

import { dbConfig, REPO_ROOT } from '../scripts/_lib.js';

const PERF_DB = 'faze_perf';
const SIZES = [1_000, 10_000, 50_000, 100_000];
const RUNS = 5;
const USER_ID = 1; // the person the match query ranks groups for

// Same as MATCH_WEIGHTS in server/src/repositories/match.repo.ts.
const WEIGHTS = { game: 50, region: 20, availability: 30, fullAvailabilityHours: 10 };

process.env.DB_NAME = PERF_DB;
const { findMatches } = await import(
  path.join(REPO_ROOT, 'server/dist/src/repositories/match.repo.js')
);

const AVAILABILITY_INDEX = 'idx_availability_slot_day_time';
const BROWSE_SQL = `
  SELECT g.group_id, g.title, g.member_count
    FROM lfg_group g %HINT%
   WHERE g.game_id = :gameId AND g.status = 'recruiting' AND g.region_id = :regionId
   ORDER BY g.last_activity_at DESC LIMIT 20`;

async function median(fn) {
  await fn();
  const times = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)];
}

async function buildPerfDatabase(users) {
  const admin = await mysql.createConnection({ ...dbConfig, database: undefined });
  await admin.query(`DROP DATABASE IF EXISTS ${PERF_DB}`);
  await admin.query(`CREATE DATABASE ${PERF_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await admin.end();

  execFileSync('node', ['db/scripts/migrate.js'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DB_NAME: PERF_DB },
    stdio: 'ignore',
  });

  // load.sql runs on its own connection: its comments contain words like
  // `etl:all`, which a namedPlaceholders connection would read as parameters.
  const loader = await mysql.createConnection({
    ...dbConfig,
    database: PERF_DB,
    multipleStatements: true,
  });
  await loader.query('SET @users = ?', [users]);
  await loader.query(fs.readFileSync(path.join(REPO_ROOT, 'db/perf/load.sql'), 'utf8'));
  await loader.end();

  return mysql.createConnection({ ...dbConfig, database: PERF_DB, namedPlaceholders: true });
}

async function scalingRun(conn) {
  const [[sample]] = await conn.query(
    'SELECT game_id AS gameId, region_id AS regionId FROM lfg_group ORDER BY group_id LIMIT 1',
  );
  const browse = (hint) => conn.query(BROWSE_SQL.replace('%HINT%', hint), sample);

  const result = {
    browseNoIndex: await median(() =>
      browse('IGNORE INDEX (idx_lfg_group_recruit, fk_lfg_group_region)'),
    ),
    browseIndexed: await median(() => browse('')),
    matchIndexed: await median(() => findMatches(USER_ID, 20, conn)),
  };

  await conn.query(`ALTER TABLE availability_slot DROP INDEX ${AVAILABILITY_INDEX}`);
  result.matchNoIndex = await median(() => findMatches(USER_ID, 20, conn));
  await conn.query(
    `ALTER TABLE availability_slot ADD KEY ${AVAILABILITY_INDEX}
       (day_of_week, start_minute, end_minute, user_id)`,
  );
  return result;
}

/** Baseline 1: one flat table instead of user, profile, region, user_game and game. */
async function flatTableBaseline(conn) {
  await conn.query(`
    CREATE TABLE flat_user_game AS
    SELECT u.user_id, u.email, p.display_name, r.name AS region_name,
           g.game_id, g.title AS game_title
      FROM \`user\` u
      JOIN profile p ON p.user_id = u.user_id
      LEFT JOIN region r ON r.region_id = p.region_id
      JOIN user_game ug ON ug.user_id = u.user_id
      JOIN game g ON g.game_id = ug.game_id`);

  const [[popular]] = await conn.query(
    `SELECT game_id AS gameId FROM user_game GROUP BY game_id ORDER BY COUNT(*) DESC LIMIT 1`,
  );
  const [flatGame] = await conn.query(
    `UPDATE flat_user_game SET game_title = CONCAT(game_title, ' ') WHERE game_id = :gameId`,
    popular,
  );
  const [normalGame] = await conn.query(
    `UPDATE game SET title = CONCAT(title, ' ') WHERE game_id = :gameId`,
    popular,
  );
  const [[region]] = await conn.query(
    `SELECT r.region_id AS regionId, r.name FROM profile p JOIN region r ON r.region_id = p.region_id
      GROUP BY r.region_id ORDER BY COUNT(*) DESC LIMIT 1`,
  );
  const renamed = { ...region, newName: `${region.name} (renamed)` };
  const [flatRegion] = await conn.query(
    'UPDATE flat_user_game SET region_name = :newName WHERE region_name = :name',
    renamed,
  );
  const [normalRegion] = await conn.query(
    'UPDATE region SET name = :newName WHERE region_id = :regionId',
    renamed,
  );
  const [[{ n: flatRows }]] = await conn.query('SELECT COUNT(*) AS n FROM flat_user_game');
  await conn.query('DROP TABLE flat_user_game');

  return {
    flatRows,
    gameTitle: { flat: flatGame.affectedRows, normalised: normalGame.affectedRows },
    regionName: { flat: flatRegion.affectedRows, normalised: normalRegion.affectedRows },
  };
}

/** Baseline 2: the same ranking computed in Node after fetching the raw rows. */
async function matchesInAppCode(conn, userId) {
  const [[me]] = await conn.query('SELECT region_id FROM profile WHERE user_id = ?', [userId]);
  const [myGames] = await conn.query('SELECT game_id FROM user_game WHERE user_id = ?', [userId]);
  const [groups] = await conn.query(
    `SELECT group_id, game_id, region_id, member_count, last_activity_at
       FROM v_group_card
      WHERE visibility = 'open' AND status = 'recruiting' AND open_slots > 0`,
  );
  const [members] = await conn.query(
    `SELECT group_id, user_id FROM group_member WHERE state = 'active'`,
  );
  const [slots] = await conn.query(
    'SELECT user_id, day_of_week, start_minute, end_minute FROM v_user_availability_minutes',
  );
  const rowsFetched = 1 + myGames.length + groups.length + members.length + slots.length;

  const gameIds = new Set(myGames.map((g) => g.game_id));
  const slotsByUser = new Map();
  for (const s of slots) {
    if (!slotsByUser.has(s.user_id)) slotsByUser.set(s.user_id, []);
    slotsByUser.get(s.user_id).push(s);
  }
  const mySlots = slotsByUser.get(userId) ?? [];
  const sharedMinutes = new Map();
  const myGroups = new Set();
  for (const m of members) {
    if (m.user_id === userId) myGroups.add(m.group_id);
    for (const theirs of slotsByUser.get(m.user_id) ?? []) {
      for (const mine of mySlots) {
        if (mine.day_of_week !== theirs.day_of_week) continue;
        const overlap =
          Math.min(mine.end_minute, theirs.end_minute) -
          Math.max(mine.start_minute, theirs.start_minute);
        if (overlap > 0) {
          sharedMinutes.set(m.group_id, (sharedMinutes.get(m.group_id) ?? 0) + overlap);
        }
      }
    }
  }

  const ranked = groups
    .filter((g) => !myGroups.has(g.group_id))
    .map((g) => {
      const hours = g.member_count ? (sharedMinutes.get(g.group_id) ?? 0) / 60 / g.member_count : 0;
      const score =
        WEIGHTS.game * Number(gameIds.has(g.game_id)) +
        WEIGHTS.region * Number(g.region_id === me.region_id) +
        Math.min(
          WEIGHTS.availability,
          (WEIGHTS.availability * hours) / WEIGHTS.fullAvailabilityHours,
        );
      return { groupId: g.group_id, score, lastActivity: g.last_activity_at };
    })
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score || b.lastActivity - a.lastActivity || a.groupId - b.groupId)
    .slice(0, 20);
  return { groupIds: ranked.map((g) => g.groupId), rowsFetched };
}

async function sqlVersusAppBaseline(conn) {
  const sql = await findMatches(USER_ID, 20, conn);
  const app = await matchesInAppCode(conn, USER_ID);
  return {
    sameTop20: JSON.stringify(sql.map((m) => m.groupId)) === JSON.stringify(app.groupIds),
    sqlMs: await median(() => findMatches(USER_ID, 20, conn)),
    appMs: await median(() => matchesInAppCode(conn, USER_ID)),
    sqlRows: sql.length,
    appRows: app.rowsFetched,
  };
}

/** Baseline 3: the stored member_count against counting members on every read. */
async function storedCountBaseline(conn) {
  const stored = `SELECT COUNT(*) AS n FROM lfg_group
                   WHERE status = 'recruiting' AND member_count < max_members`;
  const counted = `SELECT COUNT(*) AS n FROM lfg_group g
                    WHERE g.status = 'recruiting'
                      AND (SELECT COUNT(*) FROM group_member gm
                            WHERE gm.group_id = g.group_id AND gm.state = 'active') < g.max_members`;
  const [[a]] = await conn.query(stored);
  const [[b]] = await conn.query(counted);
  return {
    sameAnswer: a.n === b.n,
    openGroups: a.n,
    storedMs: await median(() => conn.query(stored)),
    countedMs: await median(() => conn.query(counted)),
  };
}

/** A small line chart as SVG: one line per series, sizes on the x axis. */
function lineChart(title, series) {
  const [w, h, left, bottom, top] = [640, 360, 70, 50, 40];
  const maxY = Math.max(...series.flatMap((s) => s.values)) * 1.1;
  const x = (i) => left + (i * (w - left - 30)) / (SIZES.length - 1);
  const y = (v) => h - bottom - (v / maxY) * (h - bottom - top);
  const colours = ['#5B3FE0', '#E8742C'];
  const parts = [
    // 20px past `w` leaves room for the last x-axis label.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + 20} ${h}" font-family="sans-serif" font-size="13">`,
    `<rect width="${w + 20}" height="${h}" fill="#ffffff"/>`,
    `<text x="${left}" y="24" font-size="15" font-weight="bold">${title}</text>`,
    `<line x1="${left}" y1="${h - bottom}" x2="${w - 20}" y2="${h - bottom}" stroke="#888"/>`,
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${h - bottom}" stroke="#888"/>`,
    `<text x="14" y="${(h - bottom + top) / 2}" transform="rotate(-90 14 ${(h - bottom + top) / 2})" text-anchor="middle">ms (median of ${RUNS})</text>`,
    `<text x="${(w + left) / 2}" y="${h - 10}" text-anchor="middle">users</text>`,
  ];
  for (const frac of [0, 0.5, 1]) {
    const v = maxY * frac;
    parts.push(
      `<text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(v < 10 ? 1 : 0)}</text>`,
    );
  }
  SIZES.forEach((size, i) =>
    parts.push(
      `<text x="${x(i)}" y="${h - bottom + 18}" text-anchor="middle">${size.toLocaleString('en')}</text>`,
    ),
  );
  series.forEach((s, k) => {
    const points = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    parts.push(
      `<polyline points="${points}" fill="none" stroke="${colours[k]}" stroke-width="2.5"/>`,
      ...s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${colours[k]}"/>`),
      `<text x="${left + 12}" y="${top + 18 + k * 18}" fill="${colours[k]}" font-weight="bold">${s.label}</text>`,
    );
  });
  parts.push('</svg>');
  return parts.join('\n');
}

const ms = (v) => v.toFixed(2);
const scaling = [];
let conn;
for (const users of SIZES) {
  if (conn) await conn.end();
  console.error(`Building ${users.toLocaleString('en')} users...`);
  conn = await buildPerfDatabase(users);
  scaling.push({ users, ...(await scalingRun(conn)) });
}

console.error('Baselines...');
const flat = await flatTableBaseline(conn);
const app = await sqlVersusAppBaseline(conn);
const counted = await storedCountBaseline(conn);
await conn.end();

console.log('### Scaling\n');
console.log('| Users | Browse, no index | Browse, indexed | Match, no index | Match, indexed |');
console.log('| ----: | ---------------: | --------------: | --------------: | -------------: |');
for (const r of scaling) {
  console.log(
    `| ${r.users.toLocaleString('en')} | ${ms(r.browseNoIndex)} | ${ms(r.browseIndexed)} | ${ms(r.matchNoIndex)} | ${ms(r.matchIndexed)} |`,
  );
}

const big = SIZES.at(-1).toLocaleString('en');
console.log(`\n### Baselines (${big} users)\n`);
console.log(`Flat table: ${flat.flatRows.toLocaleString('en')} rows.\n`);
console.log('| Change | Rows updated, flat table | Rows updated, normalised |');
console.log('| ------ | -----------------------: | -----------------------: |');
console.log(
  `| Rename the most-owned game | ${flat.gameTitle.flat} | ${flat.gameTitle.normalised} |`,
);
console.log(`| Rename a region | ${flat.regionName.flat} | ${flat.regionName.normalised} |`);
console.log('\n| Match ranking | Time (ms) | Rows sent to Node | Same top 20 |');
console.log('| ------------- | --------: | ----------------: | :---------: |');
console.log(
  `| In SQL (what FAZE runs) | ${ms(app.sqlMs)} | ${app.sqlRows} | ${app.sameTop20 ? 'yes' : 'NO'} |`,
);
console.log(`| In app code | ${ms(app.appMs)} | ${app.appRows.toLocaleString('en')} | |`);
console.log('\n| Open groups with a free seat | Time (ms) | Answer |');
console.log('| ---------------------------- | --------: | -----: |');
console.log(`| Stored member_count | ${ms(counted.storedMs)} | ${counted.openGroups} |`);
console.log(
  `| COUNT(*) per group | ${ms(counted.countedMs)} | ${counted.sameAnswer ? 'same' : 'DIFFERENT'} |`,
);

const img = (name, svg) => fs.writeFileSync(path.join(REPO_ROOT, 'docs/img', name), `${svg}\n`);
img(
  'scaling-match.svg',
  lineChart('Match query', [
    { label: 'no availability index', values: scaling.map((r) => r.matchNoIndex) },
    { label: 'with index', values: scaling.map((r) => r.matchIndexed) },
  ]),
);
img(
  'scaling-browse.svg',
  lineChart('Browse groups for a game and region', [
    { label: 'no index', values: scaling.map((r) => r.browseNoIndex) },
    { label: 'composite index', values: scaling.map((r) => r.browseIndexed) },
  ]),
);
