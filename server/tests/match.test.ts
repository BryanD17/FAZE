import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { createApp } from '../src/app.js';
import { closePool, pool } from '../src/db/pool.js';
import { signAccessToken } from '../src/services/tokens.js';

/**
 * GET /api/matches against a small world built in the test database.
 *
 * The person looking ("me") is in EU-West, owns game G1 and is free all day
 * Monday (UTC). Each group below earns a known score:
 *
 *   capped    G1, APAC,    owner free Mon 00:00-12:00 -> 50 + 0  + 30 (12h, capped) = 80
 *   both      G1, EU-West, owner free Mon 18:00-20:00 -> 50 + 20 + 6  (2h of 10)    = 76
 *   gameOnly  G1, APAC,    owner has no availability  -> 50
 *   regionOnly G2, EU-West, owner has no availability -> 20
 *
 * and four groups must NOT appear: nothing in common (score 0), full, already
 * joined, and not open to join.
 */

const app = createApp();
const EMAIL_SUFFIX = '@match-test.faze';
const SLUG_PREFIX = 'match-test-';

const EU_WEST = 3;
const APAC = 6;
const MONDAY = 1;

let myToken: string;
const ids: Record<string, number> = {};

async function createUser(name: string, regionId: number): Promise<number> {
  const [user] = await pool.query<ResultSetHeader>(
    `INSERT INTO \`user\` (email, password_hash, status, email_verified_at)
     VALUES (?, 'not-a-real-hash', 'active', NOW())`,
    [`${name}${EMAIL_SUFFIX}`],
  );
  await pool.query(
    `INSERT INTO profile (user_id, display_name, region_id, timezone) VALUES (?, ?, ?, 'UTC')`,
    [user.insertId, `match-${name}`, regionId],
  );
  return user.insertId;
}

async function createGame(name: string): Promise<number> {
  const [game] = await pool.query<ResultSetHeader>(
    `INSERT INTO game (title, slug, is_multiplayer) VALUES (?, ?, 1)`,
    [`Match Test ${name}`, `${SLUG_PREFIX}${name}`],
  );
  return game.insertId;
}

async function setAvailability(userId: number, start: number, end: number): Promise<void> {
  await pool.query(
    `INSERT INTO availability_slot (user_id, day_of_week, start_minute, end_minute)
     VALUES (?, ?, ?, ?)`,
    [userId, MONDAY, start, end],
  );
}

/** Creates a group through the real stored procedure (the owner joins it). */
async function createGroup(
  ownerId: number,
  gameId: number,
  regionId: number,
  title: string,
  options: { maxMembers?: number; visibility?: string } = {},
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      'CALL sp_create_group(?, ?, ?, NULL, ?, NULL, ?, ?, 0, NULL, NULL, NULL, ?, @id)',
      [
        ownerId,
        gameId,
        title,
        regionId,
        options.visibility ?? 'open',
        options.maxMembers ?? 5,
        '1',
      ],
    );
    const [rows] = await conn.query<RowDataPacket[]>('SELECT @id AS id');
    return rows[0]!.id as number;
  } finally {
    conn.release();
  }
}

async function cleanUp(): Promise<void> {
  // Groups and memberships go with their owners (ON DELETE CASCADE).
  await pool.query('DELETE FROM `user` WHERE email LIKE ?', [`%${EMAIL_SUFFIX}`]);
  await pool.query('DELETE FROM game WHERE slug LIKE ?', [`${SLUG_PREFIX}%`]);
}

beforeAll(async () => {
  await cleanUp();

  const g1 = await createGame('g1');
  const g2 = await createGame('g2');

  const me = await createUser('me', EU_WEST);
  await pool.query('INSERT INTO user_game (user_id, game_id) VALUES (?, ?)', [me, g1]);
  await setAvailability(me, 0, 1440);
  myToken = signAccessToken(me, 'match-me');

  const owners: Record<string, number> = {};
  for (const name of ['capped', 'both', 'gameOnly', 'regionOnly', 'nothing', 'full', 'secret']) {
    owners[name] = await createUser(
      name,
      name === 'capped' || name === 'gameOnly' ? APAC : EU_WEST,
    );
  }
  await setAvailability(owners.capped!, 0, 720);
  await setAvailability(owners.both!, 1080, 1200);

  ids.capped = await createGroup(owners.capped!, g1, APAC, 'capped');
  ids.both = await createGroup(owners.both!, g1, EU_WEST, 'both');
  ids.gameOnly = await createGroup(owners.gameOnly!, g1, APAC, 'gameOnly');
  ids.regionOnly = await createGroup(owners.regionOnly!, g2, EU_WEST, 'regionOnly');

  // Must not appear:
  ids.nothing = await createGroup(owners.nothing!, g2, APAC, 'nothing in common');
  ids.mine = await createGroup(me, g1, EU_WEST, 'already mine');
  ids.secret = await createGroup(owners.secret!, g1, EU_WEST, 'not open', {
    visibility: 'invite',
  });
  ids.full = await createGroup(owners.full!, g1, EU_WEST, 'full', { maxMembers: 2 });
  await pool.query('CALL sp_join_group(?, ?, @result)', [owners.capped, ids.full]);
});

afterAll(async () => {
  await cleanUp();
  await closePool();
});

describe('GET /api/matches', () => {
  it('ranks groups by game, region and shared availability', async () => {
    const { body } = await request(app)
      .get('/api/matches')
      .set('Authorization', `Bearer ${myToken}`)
      .expect(200);

    expect(body.matches.map((m: { groupId: number }) => m.groupId)).toEqual([
      ids.capped,
      ids.both,
      ids.gameOnly,
      ids.regionOnly,
    ]);
    expect(body.matches.map((m: { score: number }) => m.score)).toEqual([80, 76, 50, 20]);
  });

  it('reports why each group scored', async () => {
    const { body } = await request(app)
      .get('/api/matches')
      .set('Authorization', `Bearer ${myToken}`)
      .expect(200);
    const byId = new Map(body.matches.map((m: { groupId: number }) => [m.groupId, m]));

    expect(byId.get(ids.both)).toMatchObject({ sameGame: true, sameRegion: true, overlapHours: 2 });
    expect(byId.get(ids.capped)).toMatchObject({ sameGame: true, sameRegion: false });
    // 12 shared hours earn the full 30 availability points, not 36.
    expect(byId.get(ids.capped)).toMatchObject({ overlapHours: 12, score: 80 });
    expect(byId.get(ids.regionOnly)).toMatchObject({ sameGame: false, sameRegion: true });
  });

  it('leaves out groups with nothing in common, full, not open, or already joined', async () => {
    const { body } = await request(app)
      .get('/api/matches')
      .set('Authorization', `Bearer ${myToken}`)
      .expect(200);
    const returned = body.matches.map((m: { groupId: number }) => m.groupId);

    for (const hidden of [ids.nothing, ids.full, ids.secret, ids.mine]) {
      expect(returned).not.toContain(hidden);
    }
  });

  it('requires a signed-in user', async () => {
    await request(app).get('/api/matches').expect(401);
  });
});
