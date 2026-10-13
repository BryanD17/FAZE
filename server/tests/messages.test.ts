import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ResultSetHeader } from 'mysql2/promise';

import { createApp } from '../src/app.js';
import { closePool, pool } from '../src/db/pool.js';
import { signAccessToken } from '../src/services/tokens.js';

const app = createApp();

const EMAIL_SUFFIX = '@messages-test.faze';
const GAME_SLUG = 'messages-test-game';

const EU_WEST = 3;
const ENGLISH = 1;
const PC = 1;

const tokens: Record<string, string> = {};

let gameId: number;
let groupId: number;

async function createUser(name: string): Promise<void> {
  const [user] = await pool.query<ResultSetHeader>(
    `INSERT INTO \`user\`
       (email, password_hash, status, email_verified_at)
     VALUES (?, 'not-a-real-hash', 'active', NOW())`,
    [`${name}${EMAIL_SUFFIX}`],
  );

  const displayName = `messages-${name}`;

  await pool.query(
    `INSERT INTO profile
       (user_id, display_name, timezone)
     VALUES (?, ?, 'UTC')`,
    [user.insertId, displayName],
  );

  tokens[name] = signAccessToken(user.insertId, displayName);
}

function auth(name: string) {
  return {
    Authorization: `Bearer ${tokens[name]}`,
  };
}

async function cleanUp(): Promise<void> {
  await pool.query('DELETE FROM `user` WHERE email LIKE ?', [`%${EMAIL_SUFFIX}`]);
  await pool.query('DELETE FROM game WHERE slug = ?', [GAME_SLUG]);
}

beforeAll(async () => {
  await cleanUp();

  const [game] = await pool.query<ResultSetHeader>(
    `INSERT INTO game
       (title, slug, is_multiplayer)
     VALUES ('Messages Test Game', ?, 1)`,
    [GAME_SLUG],
  );

  gameId = game.insertId;

  await createUser('owner');
  await createUser('member');
  await createUser('outsider');

  const created = await request(app)
    .post('/api/groups')
    .set(auth('owner'))
    .send({
      gameId,
      title: 'Messages Test Group',
      description: 'Group used by the messages API tests.',
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

describe('group messages API', () => {
  it('lets a member post a message and another member read it back', async () => {
    const posted = await request(app)
      .post(`/api/groups/${groupId}/messages`)
      .set(auth('member'))
      .send({ body: 'Anyone on tonight?' })
      .expect(201);

    expect(posted.body).toMatchObject({
      messageId: expect.any(Number),
      displayName: 'messages-member',
      body: 'Anyone on tonight?',
      createdAt: expect.any(String),
    });

    const response = await request(app)
      .get(`/api/groups/${groupId}/messages`)
      .set(auth('owner'))
      .expect(200);

    expect(response.body.messages.length).toBeGreaterThan(0);

    expect(response.body.messages[0]).toMatchObject({
      messageId: posted.body.messageId,
      displayName: 'messages-member',
      body: 'Anyone on tonight?',
      createdAt: expect.any(String),
    });
  });

  it('returns 403 when a non-member tries to read messages', async () => {
    const response = await request(app)
      .get(`/api/groups/${groupId}/messages`)
      .set(auth('outsider'))
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN_GROUP_ROLE');
  });

  it('returns 403 when a non-member tries to post a message', async () => {
    const response = await request(app)
      .post(`/api/groups/${groupId}/messages`)
      .set(auth('outsider'))
      .send({ body: 'I should not be allowed to post this.' })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN_GROUP_ROLE');
  });

  it('returns 400 for an empty message', async () => {
    const response = await request(app)
      .post(`/api/groups/${groupId}/messages`)
      .set(auth('member'))
      .send({ body: '   ' })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      field: 'body',
    });
  });
});
