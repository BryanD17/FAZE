import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { createApp } from '../src/app.js';
import { closePool, pool } from '../src/db/pool.js';
import { signAccessToken } from '../src/services/tokens.js';

/**
 * The groups API: create, list, view, join, leave. Every write goes through
 * the stored procedures, so these tests also prove the procedures and the
 * member_count triggers behave as the API promises.
 */

const app = createApp();
const EMAIL_SUFFIX = '@groups-test.faze';
const SLUG_PREFIX = 'groups-test-';

const EU_WEST = 3;
const APAC = 6;
const ENGLISH = 1;
const PC = 1;
const PLAYSTATION = 2;

const tokens: Record<string, string> = {};
const games: Record<string, number> = {};

async function createUser(name: string): Promise<string> {
  const [user] = await pool.query<ResultSetHeader>(
    `INSERT INTO \`user\` (email, password_hash, status, email_verified_at)
     VALUES (?, 'not-a-real-hash', 'active', NOW())`,
    [`${name}${EMAIL_SUFFIX}`],
  );
  const displayName = `groups-${name}`;
  await pool.query(`INSERT INTO profile (user_id, display_name, timezone) VALUES (?, ?, 'UTC')`, [
    user.insertId,
    displayName,
  ]);
  tokens[name] = signAccessToken(user.insertId, displayName);
  return displayName;
}

async function createGame(name: string, multiplayer: boolean): Promise<number> {
  const [game] = await pool.query<ResultSetHeader>(
    `INSERT INTO game (title, slug, is_multiplayer) VALUES (?, ?, ?)`,
    [`Groups Test ${name}`, `${SLUG_PREFIX}${name}`, multiplayer ? 1 : 0],
  );
  return game.insertId;
}

function auth(name: string) {
  return { Authorization: `Bearer ${tokens[name]}` };
}

function newGroup(overrides: Record<string, unknown> = {}) {
  return {
    gameId: games.main,
    title: 'Ranked tonight',
    description: 'Chill ranked grind.',
    regionId: EU_WEST,
    languageId: ENGLISH,
    maxMembers: 5,
    platformIds: [PC],
    ...overrides,
  };
}

async function postGroup(owner: string, overrides: Record<string, unknown> = {}): Promise<number> {
  const { body } = await request(app)
    .post('/api/groups')
    .set(auth(owner))
    .send(newGroup(overrides))
    .expect(201);
  return body.groupId as number;
}

function join(name: string, groupId: number | string) {
  return request(app).post(`/api/groups/${groupId}/join`).set(auth(name));
}

function leave(name: string, groupId: number | string) {
  return request(app).post(`/api/groups/${groupId}/leave`).set(auth(name));
}

async function cleanUp(): Promise<void> {
  // Groups and memberships go with their owners (ON DELETE CASCADE).
  await pool.query('DELETE FROM `user` WHERE email LIKE ?', [`%${EMAIL_SUFFIX}`]);
  await pool.query('DELETE FROM game WHERE slug LIKE ?', [`${SLUG_PREFIX}%`]);
}

beforeAll(async () => {
  await cleanUp();
  games.main = await createGame('main', true);
  games.paging = await createGame('paging', true);
  games.solo = await createGame('solo', false);
  for (const name of ['owner', 'second', 'third', 'outsider']) await createUser(name);
  for (let i = 1; i <= 8; i++) await createUser(`racer${i}`);
});

afterAll(async () => {
  await cleanUp();
  await closePool();
});

describe('POST /api/groups and GET /api/groups/:id', () => {
  // Proves: a created group shows up in the list and the detail, with its creator as the only member, the owner.
  it('creates a group that appears in the list and in the detail', async () => {
    const created = await request(app)
      .post('/api/groups')
      .set(auth('owner'))
      .send(newGroup({ platformIds: [PC, PLAYSTATION, PC] }))
      .expect(201);

    expect(created.body).toMatchObject({
      title: 'Ranked tonight',
      gameId: games.main,
      gameTitle: 'Groups Test main',
      regionCode: 'EU-West',
      ownerDisplayName: 'groups-owner',
      memberCount: 1,
      maxMembers: 5,
      openSlots: 4,
      platforms: ['pc', 'playstation'],
      status: 'recruiting',
      description: 'Chill ranked grind.',
      languageCode: 'en',
      myRole: 'owner',
      members: [{ displayName: 'groups-owner', role: 'owner' }],
    });
    const groupId = created.body.groupId as number;

    const { body: list } = await request(app)
      .get(`/api/groups?gameId=${games.main}`)
      .set(auth('outsider'))
      .expect(200);
    expect(list.groups.map((g: { groupId: number }) => g.groupId)).toContain(groupId);

    const { body: detail } = await request(app)
      .get(`/api/groups/${groupId}`)
      .set(auth('outsider'))
      .expect(200);
    expect(detail).toMatchObject({ groupId, memberCount: 1, myRole: null });
  });

  // Proves: ids that do not exist, and single-player games, are refused before the procedure runs.
  it('rejects a single-player game and unknown references with 422', async () => {
    const solo = await request(app)
      .post('/api/groups')
      .set(auth('owner'))
      .send(newGroup({ gameId: games.solo }))
      .expect(422);
    expect(solo.body.error).toMatchObject({ code: 'INVALID_REFERENCE', field: 'gameId' });

    const platform = await request(app)
      .post('/api/groups')
      .set(auth('owner'))
      .send(newGroup({ platformIds: [PC, 250] }))
      .expect(422);
    expect(platform.body.error).toMatchObject({ code: 'INVALID_REFERENCE', field: 'platformIds' });

    const region = await request(app)
      .post('/api/groups')
      .set(auth('owner'))
      .send(newGroup({ regionId: 250 }))
      .expect(422);
    expect(region.body.error).toMatchObject({ code: 'INVALID_REFERENCE', field: 'regionId' });
  });

  // Proves: a malformed body is a 400 that names the offending field.
  it('rejects a bad body with 400', async () => {
    const tooBig = await request(app)
      .post('/api/groups')
      .set(auth('owner'))
      .send(newGroup({ maxMembers: 11 }))
      .expect(400);
    expect(tooBig.body.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'maxMembers' });

    const noPlatforms = await request(app)
      .post('/api/groups')
      .set(auth('owner'))
      .send(newGroup({ platformIds: [] }))
      .expect(400);
    expect(noPlatforms.body.error.field).toBe('platformIds');

    await request(app)
      .post('/api/groups')
      .set(auth('owner'))
      .send({ ...newGroup(), visibility: 'invite' })
      .expect(400);
  });

  // Proves: a malformed id is a bad request, and a missing group is a 404.
  it('answers 400 for a malformed id and 404 for a missing group', async () => {
    const bad = await request(app).get('/api/groups/abc').set(auth('owner')).expect(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'id' });
    await request(app).get('/api/groups/0').set(auth('owner')).expect(400);

    const missing = await request(app).get('/api/groups/999999999').set(auth('owner')).expect(404);
    expect(missing.body.error.code).toBe('GROUP_NOT_FOUND');
    await join('owner', 999999999).expect(404);
  });
});

describe('POST /api/groups/:id/join', () => {
  // Proves: joining raises member_count (trigger) and a second join is refused.
  it('lets a second user join, then refuses a repeat join', async () => {
    const groupId = await postGroup('owner');

    expect((await join('second', groupId).expect(200)).body).toEqual({ result: 'JOINED' });

    const { body } = await request(app)
      .get(`/api/groups/${groupId}`)
      .set(auth('second'))
      .expect(200);
    expect(body).toMatchObject({ memberCount: 2, myRole: 'member' });
    expect(body.members.map((m: { displayName: string }) => m.displayName)).toEqual([
      'groups-owner',
      'groups-second',
    ]);

    const again = await join('second', groupId).expect(409);
    expect(again.body.error.code).toBe('ALREADY_MEMBER');
  });

  // Proves: a group at max_members refuses new members with GROUP_FULL.
  it('refuses to join a full group', async () => {
    const groupId = await postGroup('owner', { maxMembers: 2 });
    await join('second', groupId).expect(200);

    const full = await join('third', groupId).expect(409);
    expect(full.body.error.code).toBe('GROUP_FULL');

    const { body } = await request(app).get(`/api/groups/${groupId}`).set(auth('third'));
    expect(body).toMatchObject({ memberCount: 2, openSlots: 0, status: 'full' });
  });

  /**
   * THE TRANSACTION EXAMPLE. Proves: when eight people race for the last seat,
   * exactly one gets it.
   *
   * The group has max_members = 2 and its owner already holds one seat, so one
   * seat is free. All eight join requests are sent at the same moment with
   * Promise.all, through the real HTTP route. Without a lock, several of them
   * could read "1 of 2 taken" at the same time and all insert. sp_join_group
   * reads the group row with SELECT ... FOR UPDATE, so the requests queue on
   * that row lock: the first one in takes the seat and commits, and each of the
   * other seven then reads the committed count (2 of 2) and answers FULL.
   */
  it('lets exactly one of eight simultaneous joiners take the last seat', async () => {
    const groupId = await postGroup('owner', { maxMembers: 2 });
    const racers = Array.from({ length: 8 }, (_, i) => `racer${i + 1}`);

    const replies = await Promise.all(racers.map((name) => join(name, groupId)));

    const winners = replies.filter((r) => r.status === 200);
    const losers = replies.filter((r) => r.status === 409);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.body).toEqual({ result: 'JOINED' });
    expect(losers).toHaveLength(7);
    for (const loser of losers) expect(loser.body.error.code).toBe('GROUP_FULL');

    // The database agrees: the stored count and the real rows both say 2.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT g.member_count,
              (SELECT COUNT(*) FROM group_member gm
                WHERE gm.group_id = g.group_id AND gm.state = 'active') AS active_rows
         FROM lfg_group g WHERE g.group_id = ?`,
      [groupId],
    );
    expect(rows[0]).toMatchObject({ member_count: 2, active_rows: 2 });
  });
});

describe('POST /api/groups/:id/leave', () => {
  // Proves: leaving lowers the count, an owner leaving promotes a successor,
  // and the last member leaving archives the group, which then counts as gone.
  it('handles a member, the owner and the last member leaving', async () => {
    const groupId = await postGroup('owner');
    await join('second', groupId).expect(200);
    await join('third', groupId).expect(200);

    expect((await leave('third', groupId).expect(200)).body).toEqual({
      result: 'LEFT_MEMBER_REMAINS',
    });
    expect((await leave('owner', groupId).expect(200)).body).toEqual({
      result: 'LEFT_SUCCESSOR_PROMOTED',
    });

    const { body } = await request(app)
      .get(`/api/groups/${groupId}`)
      .set(auth('second'))
      .expect(200);
    expect(body).toMatchObject({
      memberCount: 1,
      ownerDisplayName: 'groups-second',
      myRole: 'owner',
      members: [{ displayName: 'groups-second', role: 'owner' }],
    });

    expect((await leave('second', groupId).expect(200)).body).toEqual({
      result: 'LEFT_GROUP_ARCHIVED',
    });

    const { body: list } = await request(app)
      .get(`/api/groups?gameId=${games.main}`)
      .set(auth('owner'))
      .expect(200);
    expect(list.groups.map((g: { groupId: number }) => g.groupId)).not.toContain(groupId);
    await request(app).get(`/api/groups/${groupId}`).set(auth('second')).expect(404);
    await join('outsider', groupId).expect(404);
  });

  // Proves: leaving a group you are not in is a 404, like a group that does not exist.
  it('answers 404 to someone who is not a member', async () => {
    const groupId = await postGroup('owner');
    const reply = await leave('outsider', groupId).expect(404);
    expect(reply.body.error.code).toBe('GROUP_NOT_FOUND');
    await leave('outsider', 'abc').expect(400);
  });
});

describe('GET /api/groups', () => {
  // Proves: game, platform and region filters each narrow the list.
  it('filters by game, platform and region', async () => {
    const eu = await postGroup('owner', { gameId: games.paging, platformIds: [PC] });
    const apac = await postGroup('owner', {
      gameId: games.paging,
      regionId: APAC,
      platformIds: [PLAYSTATION],
    });

    const ids = async (query: string) => {
      const { body } = await request(app)
        .get(`/api/groups?gameId=${games.paging}${query}`)
        .set(auth('owner'))
        .expect(200);
      return body.groups.map((g: { groupId: number }) => g.groupId);
    };

    expect(await ids('')).toEqual([apac, eu]);
    expect(await ids(`&regionId=${APAC}`)).toEqual([apac]);
    expect(await ids(`&platformId=${PC}`)).toEqual([eu]);

    await request(app).get('/api/groups?regionId=abc').set(auth('owner')).expect(400);
  });

  // Proves: pages hold 20 groups, newest first, and hasMore says when another page exists.
  it('pages 20 at a time', async () => {
    const [before] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM lfg_group WHERE game_id = ?',
      [games.paging],
    );
    const toCreate = 21 - Number(before[0]!.n);
    for (let i = 0; i < toCreate; i++) await postGroup('owner', { gameId: games.paging });

    const page1 = await request(app)
      .get(`/api/groups?gameId=${games.paging}`)
      .set(auth('owner'))
      .expect(200);
    expect(page1.body).toMatchObject({ page: 1, hasMore: true });
    expect(page1.body.groups).toHaveLength(20);

    const page2 = await request(app)
      .get(`/api/groups?gameId=${games.paging}&page=2`)
      .set(auth('owner'))
      .expect(200);
    expect(page2.body).toMatchObject({ page: 2, hasMore: false });
    expect(page2.body.groups).toHaveLength(1);

    const firstPageIds = page1.body.groups.map((g: { groupId: number }) => g.groupId);
    expect(firstPageIds).not.toContain(page2.body.groups[0].groupId);
  });
});

describe('authentication', () => {
  // Proves: every groups route is closed to signed-out callers.
  it('returns 401 on all five routes without a token', async () => {
    await request(app).get('/api/groups').expect(401);
    await request(app).post('/api/groups').send(newGroup()).expect(401);
    await request(app).get('/api/groups/1').expect(401);
    await request(app).post('/api/groups/1/join').expect(401);
    await request(app).post('/api/groups/1/leave').expect(401);
  });
});
