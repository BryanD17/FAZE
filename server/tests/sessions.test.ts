import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ResultSetHeader } from 'mysql2/promise';

import { createApp } from '../src/app.js';
import { closePool, pool } from '../src/db/pool.js';
import { signAccessToken } from '../src/services/tokens.js';

const app = createApp();
const EMAIL_SUFFIX = '@sessions-test.faze';
const GAME_SLUG = 'sessions-test-game';
const EU_WEST = 3;
const ENGLISH = 1;
const PC = 1;

const tokens: Record<string, string> = {};
const userIds: Record<string, number> = {};
let gameId: number;
let groupId: number;

async function createUser(name: string): Promise<void> {
  const [user] = await pool.query<ResultSetHeader>(
    `INSERT INTO \`user\` (email, password_hash, status, email_verified_at)
     VALUES (?, 'not-a-real-hash', 'active', NOW())`,
    [`${name}${EMAIL_SUFFIX}`],
  );
  const displayName = `sessions-${name}`;
  await pool.query(`INSERT INTO profile (user_id, display_name, timezone) VALUES (?, ?, 'UTC')`, [
    user.insertId,
    displayName,
  ]);
  userIds[name] = user.insertId;
  tokens[name] = signAccessToken(user.insertId, displayName);
}

function auth(name: string) {
  return { Authorization: `Bearer ${tokens[name]}` };
}

async function schedule(name: string, startsAt: string): Promise<number> {
  const { body } = await request(app)
    .post(`/api/groups/${groupId}/sessions`)
    .set(auth(name))
    .send({ startsAt })
    .expect(201);
  return body.sessionId as number;
}

async function cleanUp(): Promise<void> {
  await pool.query('DELETE FROM `user` WHERE email LIKE ?', [`%${EMAIL_SUFFIX}`]);
  await pool.query('DELETE FROM game WHERE slug = ?', [GAME_SLUG]);
}

beforeAll(async () => {
  await cleanUp();
  const [game] = await pool.query<ResultSetHeader>(
    `INSERT INTO game (title, slug, is_multiplayer)
     VALUES ('Sessions Test Game', ?, 1)`,
    [GAME_SLUG],
  );
  gameId = game.insertId;

  for (const name of ['owner', 'member', 'outsider']) await createUser(name);

  const created = await request(app)
    .post('/api/groups')
    .set(auth('owner'))
    .send({
      gameId,
      title: 'Sessions Test Group',
      description: 'Group used by the sessions API tests.',
      regionId: EU_WEST,
      languageId: ENGLISH,
      maxMembers: 5,
      platformIds: [PC],
    })
    .expect(201);
  groupId = created.body.groupId as number;

  await request(app).post(`/api/groups/${groupId}/join`).set(auth('member')).expect(200);
});

afterAll(async () => {
  await cleanUp();
  await closePool();
});

describe('play sessions and ratings API', () => {
  it('lets a member schedule a session and see it in the list', async () => {
    const startsAt = '2030-01-10T20:00:00.000Z';
    const sessionId = await schedule('member', startsAt);

    const { body } = await request(app)
      .get(`/api/groups/${groupId}/sessions`)
      .set(auth('owner'))
      .expect(200);

    expect(body.sessions).toContainEqual(
      expect.objectContaining({
        sessionId,
        groupId,
        startsAt,
        state: 'scheduled',
      }),
    );
  });

  it('returns 403 to a non-member', async () => {
    await request(app)
      .post(`/api/groups/${groupId}/sessions`)
      .set(auth('outsider'))
      .send({ startsAt: '2030-01-11T20:00:00.000Z' })
      .expect(403);

    await request(app).get(`/api/groups/${groupId}/sessions`).set(auth('outsider')).expect(403);
  });

  it('refuses a rating before the session is marked played', async () => {
    const sessionId = await schedule('member', '2030-01-12T20:00:00.000Z');

    const response = await request(app)
      .post(`/api/sessions/${sessionId}/ratings`)
      .set(auth('member'))
      .send({ rateeUserId: userIds.owner, score: 5 })
      .expect(409);

    expect(response.body.error.code).toBe('RATING_REJECTED');
    expect(response.body.error.message).toContain('not been marked played');
  });

  it('lets the owner mark a session played and a member rate a teammate', async () => {
    const sessionId = await schedule('owner', '2030-01-13T20:00:00.000Z');

    const played = await request(app)
      .post(`/api/sessions/${sessionId}/played`)
      .set(auth('owner'))
      .expect(200);
    expect(played.body).toMatchObject({ sessionId, state: 'played' });

    await request(app)
      .post(`/api/sessions/${sessionId}/ratings`)
      .set(auth('member'))
      .send({ rateeUserId: userIds.owner, score: 4 })
      .expect(201, { ok: true });
  });

  it('refuses to mark a session played twice', async () => {
    const sessionId = await schedule('owner', '2030-01-15T20:00:00.000Z');
    await request(app).post(`/api/sessions/${sessionId}/played`).set(auth('owner')).expect(200);

    const response = await request(app)
      .post(`/api/sessions/${sessionId}/played`)
      .set(auth('owner'))
      .expect(409);
    expect(response.body.error.code).toBe('SESSION_NOT_SCHEDULED');
  });

  it('refuses self-rating', async () => {
    const sessionId = await schedule('owner', '2030-01-14T20:00:00.000Z');
    await request(app).post(`/api/sessions/${sessionId}/played`).set(auth('owner')).expect(200);

    const response = await request(app)
      .post(`/api/sessions/${sessionId}/ratings`)
      .set(auth('member'))
      .send({ rateeUserId: userIds.member, score: 5 })
      .expect(409);

    expect(response.body.error.code).toBe('RATING_REJECTED');
  });
});
