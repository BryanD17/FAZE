/**
 * Concurrency experiment for issue #50.
 *
 * Start the API first, then run:
 *   node db/perf/join-load.js
 *
 * The normal product caps groups at 10 members, so every run starts with one
 * owner and nine free seats. We create temporary users directly in MySQL, then
 * send 50, 100 and 200 join requests through the real HTTP API at once.
 */
import crypto from 'node:crypto';

import { assertNotProduction, banner, connect } from '../scripts/_lib.js';

assertNotProduction('node db/perf/join-load.js');

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const EMAIL_DOMAIN = '@join-load.faze';
const GAME_SLUG = 'join-load-game';
const REQUEST_SIZES = [50, 100, 200];
const RUNS_PER_SIZE = 3;
const MAX_MEMBERS = 10;
const OWNER_EMAIL = `owner${EMAIL_DOMAIN}`;

if (!JWT_ACCESS_SECRET || JWT_ACCESS_SECRET.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must be set to the same secret used by the running API.');
}

function accessToken(userId, displayName) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ displayName, sub: String(userId), iat: now, exp: now + 15 * 60 }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signature = crypto
    .createHmac('sha256', JWT_ACCESS_SECRET)
    .update(unsigned)
    .digest('base64url');
  return `${unsigned}.${signature}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

async function clean(conn) {
  await conn.query("DELETE FROM lfg_group WHERE title LIKE 'Concurrency load %'");
  await conn.query('DELETE FROM `user` WHERE email LIKE ?', [`%${EMAIL_DOMAIN}`]);
  await conn.query('DELETE FROM game WHERE slug = ?', [GAME_SLUG]);
}

async function createFixtures(conn) {
  await clean(conn);

  const [gameResult] = await conn.query(
    `INSERT INTO game (title, slug, is_multiplayer)
     VALUES ('Concurrency Load Test Game', ?, 1)`,
    [GAME_SLUG],
  );
  const gameId = gameResult.insertId;

  const [ownerResult] = await conn.query(
    `INSERT INTO \`user\` (email, password_hash, status, email_verified_at)
     VALUES (?, 'not-used-by-load-test', 'active', NOW())`,
    [OWNER_EMAIL],
  );
  await conn.query(
    `INSERT INTO profile (user_id, display_name, timezone)
     VALUES (?, 'Join Load Owner', 'UTC')`,
    [ownerResult.insertId],
  );

  const joiners = [];
  for (let i = 1; i <= Math.max(...REQUEST_SIZES); i += 1) {
    const email = `joiner-${i}${EMAIL_DOMAIN}`;
    const displayName = `JoinLoad${i}`;
    const [userResult] = await conn.query(
      `INSERT INTO \`user\` (email, password_hash, status, email_verified_at)
       VALUES (?, 'not-used-by-load-test', 'active', NOW())`,
      [email],
    );
    await conn.query(
      `INSERT INTO profile (user_id, display_name, timezone)
       VALUES (?, ?, 'UTC')`,
      [userResult.insertId, displayName],
    );
    joiners.push({
      userId: userResult.insertId,
      token: accessToken(userResult.insertId, displayName),
    });
  }

  return { gameId, ownerId: ownerResult.insertId, joiners };
}

async function createGroup(conn, ownerId, gameId, size, run) {
  const title = `Concurrency load ${size}-${run}-${Date.now()}`;
  await conn.query(
    `CALL sp_create_group(?, ?, ?, ?, 3, 1, 'open', ?, 0, NULL, NULL, NULL, '1', @group_id)`,
    [ownerId, gameId, title, 'Temporary group for the join concurrency experiment.', MAX_MEMBERS],
  );
  const [[row]] = await conn.query('SELECT @group_id AS groupId');
  return row.groupId;
}

async function sendJoin(groupId, token) {
  const started = performance.now();
  const response = await fetch(`${API_BASE_URL}/api/groups/${groupId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const elapsedMs = performance.now() - started;
  const body = await response.json().catch(() => null);
  return { status: response.status, body, elapsedMs };
}

async function runOnce(conn, fixtures, size, run) {
  const groupId = await createGroup(conn, fixtures.ownerId, fixtures.gameId, size, run);
  const replies = await Promise.all(
    fixtures.joiners.slice(0, size).map((joiner) => sendJoin(groupId, joiner.token)),
  );

  const joined = replies.filter((reply) => reply.status === 200).length;
  const full = replies.filter(
    (reply) => reply.status === 409 && reply.body?.error?.code === 'GROUP_FULL',
  ).length;
  const unexpected = replies.length - joined - full;
  if (unexpected !== 0) {
    throw new Error(`${unexpected} join request(s) returned an unexpected response.`);
  }

  const [[counts]] = await conn.query(
    `SELECT g.max_members, g.member_count,
            (SELECT COUNT(*) FROM group_member gm
              WHERE gm.group_id = g.group_id AND gm.state = 'active') AS active_rows
       FROM lfg_group g
      WHERE g.group_id = ?`,
    [groupId],
  );

  const overLimit =
    counts.member_count > counts.max_members || counts.active_rows > counts.max_members;
  if (counts.member_count !== counts.active_rows) {
    throw new Error(
      `member_count drifted: stored=${counts.member_count}, active rows=${counts.active_rows}`,
    );
  }

  const times = replies.map((reply) => reply.elapsedMs);
  return {
    requests: size,
    run,
    joined,
    full,
    overLimit,
    medianMs: median(times),
    slowestMs: Math.max(...times),
  };
}

function printTable(results) {
  console.log('\n| Requests | Run | Joined | Full | Over limit | Median ms | Slowest ms |');
  console.log('| ---: | ---: | ---: | ---: | :---: | ---: | ---: |');
  for (const row of results) {
    console.log(
      `| ${row.requests} | ${row.run} | ${row.joined} | ${row.full} | ${row.overLimit ? 'YES' : 'no'} | ${row.medianMs.toFixed(1)} | ${row.slowestMs.toFixed(1)} |`,
    );
  }
}

async function main() {
  banner('Join concurrency experiment');
  console.log(`  API: ${API_BASE_URL}`);
  console.log(`  Group capacity: ${MAX_MEMBERS} (owner + 9 free seats)`);

  const conn = await connect();
  try {
    const fixtures = await createFixtures(conn);
    const results = [];
    for (const size of REQUEST_SIZES) {
      for (let run = 1; run <= RUNS_PER_SIZE; run += 1) {
        const result = await runOnce(conn, fixtures, size, run);
        results.push(result);
        console.log(
          `  ${size} requests, run ${run}: ${result.joined} joined, ${result.full} full, median ${result.medianMs.toFixed(1)} ms, slowest ${result.slowestMs.toFixed(1)} ms`,
        );
      }
    }
    printTable(results);
  } finally {
    await clean(conn);
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`\n  Concurrency experiment failed: ${err.message}\n`);
  process.exit(1);
});
