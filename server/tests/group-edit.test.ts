import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ResultSetHeader } from 'mysql2/promise';

import { createApp } from '../src/app.js';
import { closePool, pool } from '../src/db/pool.js';
import { signAccessToken } from '../src/services/tokens.js';

const app = createApp();
const EMAIL_SUFFIX = '@group-edit-test.faze';
const GAME_SLUG = 'group-edit-test-game';
const EU_WEST = 3;
const ENGLISH = 1;
const PC = 1;

const tokens: Record<string, string> = {};
let gameId: number;

async function createUser(name: string): Promise<void> {
  const [user] = await pool.query<ResultSetHeader>(
    `INSERT INTO \`user\` (email, password_hash, status, email_verified_at)
     VALUES (?, 'not-a-real-hash', 'active', NOW())`,
    [`${name}${EMAIL_SUFFIX}`],
  );
  const displayName = `group-edit-${name}`;
  await pool.query(`INSERT INTO profile (user_id, display_name, timezone) VALUES (?, ?, 'UTC')`, [
    user.insertId,
    displayName,
  ]);
  tokens[name] = signAccessToken(user.insertId, displayName);
}

function auth(name: string) {
  return { Authorization: `Bearer ${tokens[name]}` };
}

async function createGroup(maxMembers = 5): Promise<number> {
  const { body } = await request(app)
    .post('/api/groups')
    .set(auth('owner'))
    .send({
      gameId,
      title: 'Original group title',
      description: 'Original description',
      regionId: EU_WEST,
      languageId: ENGLISH,
      maxMembers,
      platformIds: [PC],
    })
    .expect(201);
  return body.groupId as number;
}

async function cleanUp(): Promise<void> {
  await pool.query('DELETE FROM `user` WHERE email LIKE ?', [`%${EMAIL_SUFFIX}`]);
  await pool.query('DELETE FROM game WHERE slug = ?', [GAME_SLUG]);
}

beforeAll(async () => {
  await cleanUp();
  const [game] = await pool.query<ResultSetHeader>(
    `INSERT INTO game (title, slug, is_multiplayer)
     VALUES ('Group Edit Test Game', ?, 1)`,
    [GAME_SLUG],
  );
  gameId = game.insertId;
  for (const name of ['owner', 'member1', 'member2', 'outsider']) await createUser(name);
});

afterAll(async () => {
  await cleanUp();
  await closePool();
});

describe('PATCH /api/groups/:id', () => {
  it('lets the owner edit and close a group', async () => {
    const groupId = await createGroup(2);
    await request(app).post(`/api/groups/${groupId}/join`).set(auth('member1')).expect(200);

    const edited = await request(app)
      .patch(`/api/groups/${groupId}`)
      .set(auth('owner'))
      .send({ title: 'Updated group title', description: 'Updated description', maxMembers: 6 })
      .expect(200);

    expect(edited.body).toMatchObject({
      groupId,
      title: 'Updated group title',
      description: 'Updated description',
      maxMembers: 6,
      openSlots: 4,
      status: 'recruiting',
      myRole: 'owner',
    });

    const closed = await request(app)
      .patch(`/api/groups/${groupId}`)
      .set(auth('owner'))
      .send({ close: true })
      .expect(200);
    expect(closed.body).toEqual({ groupId, status: 'archived' });

    const { body: list } = await request(app)
      .get(`/api/groups?gameId=${gameId}`)
      .set(auth('owner'))
      .expect(200);
    expect(list.groups.map((group: { groupId: number }) => group.groupId)).not.toContain(groupId);
  });

  it('returns 403 to a non-owner', async () => {
    const groupId = await createGroup();
    await request(app).post(`/api/groups/${groupId}/join`).set(auth('member1')).expect(200);

    const response = await request(app)
      .patch(`/api/groups/${groupId}`)
      .set(auth('member1'))
      .send({ title: 'Should not work' })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN_GROUP_ROLE');
  });

  it('refuses a member limit below the current member count', async () => {
    const groupId = await createGroup();
    await request(app).post(`/api/groups/${groupId}/join`).set(auth('member1')).expect(200);
    await request(app).post(`/api/groups/${groupId}/join`).set(auth('member2')).expect(200);

    const response = await request(app)
      .patch(`/api/groups/${groupId}`)
      .set(auth('owner'))
      .send({ maxMembers: 2 })
      .expect(409);

    expect(response.body.error).toMatchObject({
      code: 'GROUP_LIMIT_BELOW_MEMBER_COUNT',
      field: 'maxMembers',
    });
  });
});
