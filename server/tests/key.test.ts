import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { createApp } from '../src/app.js';
import { closePool, pool } from '../src/db/pool.js';
import { signAccessToken } from '../src/services/tokens.js';

/**
 * The key tests for the final report (issue #19, task 7): one short test per
 * rule, each with a comment saying what it proves.
 *
 *   1. Database rules: foreign keys, UNIQUE, CHECK, and the member_count
 *      triggers, tested with plain SQL so they hold even if the API is
 *      bypassed.
 *   2. One create / read / update / delete example through the API.
 *   3. The important 401 and 400 answers.
 *
 * The 8-people-one-seat race test lives in groups.test.ts.
 */

const app = createApp();
const EMAIL_SUFFIX = '@key-test.faze';
const SLUG_PREFIX = 'key-test-';
const EU_WEST = 3;

const users: Record<string, number> = {};
const tokens: Record<string, string> = {};
let gameId = 0;

async function createUser(name: string) {
  const [user] = await pool.query<ResultSetHeader>(
    `INSERT INTO \`user\` (email, password_hash, status, email_verified_at)
     VALUES (?, 'not-a-real-hash', 'active', NOW())`,
    [`${name}${EMAIL_SUFFIX}`],
  );
  const displayName = `key-${name}`;
  await pool.query(`INSERT INTO profile (user_id, display_name, timezone) VALUES (?, ?, 'UTC')`, [
    user.insertId,
    displayName,
  ]);
  users[name] = user.insertId;
  tokens[name] = signAccessToken(user.insertId, displayName);
}

async function createGroup(owner: string, maxMembers: number): Promise<number> {
  const [group] = await pool.query<ResultSetHeader>(
    `INSERT INTO lfg_group (owner_user_id, game_id, title, region_id, max_members)
     VALUES (?, ?, 'Key test group', ?, ?)`,
    [users[owner], gameId, EU_WEST, maxMembers],
  );
  return group.insertId;
}

async function addMember(groupId: number, name: string, role = 'member') {
  await pool.query(`INSERT INTO group_member (group_id, user_id, role) VALUES (?, ?, ?)`, [
    groupId,
    users[name],
    role,
  ]);
}

async function groupRow(groupId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT member_count, status FROM lfg_group WHERE group_id = ?',
    [groupId],
  );
  return rows[0] as { member_count: number; status: string };
}

function auth(name: string) {
  return { Authorization: `Bearer ${tokens[name]}` };
}

async function cleanUp() {
  // Groups and memberships go with their owners (ON DELETE CASCADE).
  await pool.query('DELETE FROM `user` WHERE email LIKE ?', [`%${EMAIL_SUFFIX}`]);
  await pool.query('DELETE FROM game WHERE slug LIKE ?', [`${SLUG_PREFIX}%`]);
}

beforeAll(async () => {
  await cleanUp();
  const [game] = await pool.query<ResultSetHeader>(
    `INSERT INTO game (title, slug, is_multiplayer) VALUES ('Key Test Game', ?, 1)`,
    [`${SLUG_PREFIX}main`],
  );
  gameId = game.insertId;
  for (const name of ['owner', 'second', 'third', 'crud']) await createUser(name);
});

afterAll(async () => {
  await cleanUp();
  await closePool();
});

describe('database rules', () => {
  it('foreign key: a group cannot point at a game that does not exist', async () => {
    // Proves fk_lfg_group_game: the database itself refuses an orphan row,
    // so no code path can create a group for a missing game.
    await expect(
      pool.query(
        `INSERT INTO lfg_group (owner_user_id, game_id, title, max_members)
         VALUES (?, 4294967295, 'Orphan', 4)`,
        [users.owner],
      ),
    ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
  });

  it('foreign key RESTRICT: a game with live groups cannot be deleted', async () => {
    // Proves ON DELETE RESTRICT on fk_lfg_group_game: the catalog ETL cannot
    // silently wipe out groups by removing their game.
    const groupId = await createGroup('owner', 4);
    await expect(pool.query('DELETE FROM game WHERE game_id = ?', [gameId])).rejects.toMatchObject({
      code: 'ER_ROW_IS_REFERENCED_2',
    });
    await pool.query('DELETE FROM lfg_group WHERE group_id = ?', [groupId]);
  });

  it('foreign key CASCADE: deleting an account removes its profile and memberships', async () => {
    // Proves ON DELETE CASCADE on profile and group_member: deleting a user
    // leaves no rows behind that point at them.
    await createUser('temp');
    const groupId = await createGroup('owner', 4);
    await addMember(groupId, 'temp');
    await pool.query('DELETE FROM `user` WHERE user_id = ?', [users.temp]);

    const [left] = await pool.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM profile WHERE user_id = ?) AS profiles,
              (SELECT COUNT(*) FROM group_member WHERE user_id = ?) AS memberships`,
      [users.temp, users.temp],
    );
    expect(left[0]).toMatchObject({ profiles: 0, memberships: 0 });
    await pool.query('DELETE FROM lfg_group WHERE group_id = ?', [groupId]);
  });

  it('UNIQUE: two accounts cannot share an email', async () => {
    // Proves uq_user_email: the database is the last line of defence even if
    // two registrations race past the service's own "email taken" check.
    await expect(
      pool.query(`INSERT INTO \`user\` (email, password_hash, status) VALUES (?, 'x', 'active')`, [
        `owner${EMAIL_SUFFIX}`,
      ]),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  it('UNIQUE: two profiles cannot share a display name', async () => {
    // Proves uq_profile_display_name, which public profile URLs rely on.
    await expect(
      pool.query(`UPDATE profile SET display_name = 'key-owner' WHERE user_id = ?`, [users.second]),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  it('CHECK: a group must allow between 2 and 50 members', async () => {
    // Proves ck_lfg_group_max_members: a one-person "group" is impossible.
    await expect(createGroup('owner', 1)).rejects.toMatchObject({
      code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    });
  });

  it('CHECK: an availability slot must end after it starts', async () => {
    // Proves ck_availability_slot_order: an inverted slot could otherwise
    // produce negative overlap minutes and corrupt the match score.
    await expect(
      pool.query(
        `INSERT INTO availability_slot (user_id, day_of_week, start_minute, end_minute)
         VALUES (?, 1, 600, 540)`,
        [users.owner],
      ),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  });

  it('trigger: member_count follows joins, leaves, rejoins and hard deletes', async () => {
    // Proves trg_group_member_ai / _au / _ad keep the one deliberate
    // denormalisation (lfg_group.member_count) equal to the real count.
    const groupId = await createGroup('owner', 5);
    await addMember(groupId, 'owner', 'owner');
    await addMember(groupId, 'second');
    expect((await groupRow(groupId)).member_count).toBe(2);

    await pool.query(
      `UPDATE group_member SET state = 'left', left_at = NOW() WHERE group_id = ? AND user_id = ?`,
      [groupId, users.second],
    );
    expect((await groupRow(groupId)).member_count).toBe(1);

    await pool.query(
      `UPDATE group_member SET state = 'active', left_at = NULL WHERE group_id = ? AND user_id = ?`,
      [groupId, users.second],
    );
    expect((await groupRow(groupId)).member_count).toBe(2);

    await pool.query('DELETE FROM group_member WHERE group_id = ? AND user_id = ?', [
      groupId,
      users.second,
    ]);
    expect((await groupRow(groupId)).member_count).toBe(1);

    // And the reconciliation view agrees: no drift for this group.
    const [drift] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM v_member_count_reconciliation
        WHERE group_id = ? AND drift <> 0`,
      [groupId],
    );
    expect(drift[0]?.n).toBe(0);
    await pool.query('DELETE FROM lfg_group WHERE group_id = ?', [groupId]);
  });

  it('trigger: a group flips to "full" at capacity and back to "recruiting" when someone leaves', async () => {
    // Proves the status half of the membership triggers, which the browse
    // and match queries use to hide full groups.
    const groupId = await createGroup('owner', 2);
    await addMember(groupId, 'owner', 'owner');
    await addMember(groupId, 'second');
    expect(await groupRow(groupId)).toMatchObject({ member_count: 2, status: 'full' });

    await pool.query(`UPDATE group_member SET state = 'left' WHERE group_id = ? AND user_id = ?`, [
      groupId,
      users.second,
    ]);
    expect(await groupRow(groupId)).toMatchObject({ member_count: 1, status: 'recruiting' });
    await pool.query('DELETE FROM lfg_group WHERE group_id = ?', [groupId]);
  });

  it('CHECK backstop: even a raw insert cannot push a group over its limit', async () => {
    // Proves ck_lfg_group_member_count: if code ever skipped sp_join_group's
    // row lock, the trigger's UPDATE would break the CHECK and the whole
    // INSERT is rolled back, so the group never holds more than max_members.
    const groupId = await createGroup('owner', 2);
    await addMember(groupId, 'owner', 'owner');
    await addMember(groupId, 'second');
    await expect(addMember(groupId, 'third')).rejects.toMatchObject({
      code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM group_member WHERE group_id = ? AND state = 'active'`,
      [groupId],
    );
    expect(rows[0]?.n).toBe(2);
    expect((await groupRow(groupId)).member_count).toBe(2);
    await pool.query('DELETE FROM lfg_group WHERE group_id = ?', [groupId]);
  });
});

describe('create, read, update, delete through the API (the game library)', () => {
  it('adds a game, lists it, updates the profile, and removes the game', async () => {
    // Proves one full CRUD cycle end to end: HTTP -> validation -> service ->
    // repository -> MySQL, and that each step is visible to the next.
    await request(app).post('/api/profile/me/games').set(auth('crud')).send({ gameId }).expect(201); // Create

    const listed = await request(app).get('/api/profile/me/games').set(auth('crud')).expect(200);
    expect(listed.body).toEqual([expect.objectContaining({ id: gameId })]); // Read

    await request(app)
      .patch('/api/profile/me')
      .set(auth('crud'))
      .send({ displayName: 'key-crud-renamed' })
      .expect(200); // Update
    const me = await request(app).get('/api/profile/me').set(auth('crud')).expect(200);
    expect(me.body.displayName).toBe('key-crud-renamed');

    await request(app).delete(`/api/profile/me/games/${gameId}`).set(auth('crud')).expect(204); // Delete
    const after = await request(app).get('/api/profile/me/games').set(auth('crud')).expect(200);
    expect(after.body).toEqual([]);
  });
});

describe('the important 401 and 400 answers', () => {
  it('401: every private route refuses a request with no token', async () => {
    // Proves requireAuth guards the routes that read or change personal data.
    for (const [method, path] of [
      ['get', '/api/profile/me'],
      ['get', '/api/matches'],
      ['get', '/api/groups'],
      ['post', '/api/groups'],
      ['post', '/api/groups/1/join'],
      ['put', '/api/profile/me/availability'],
    ] as const) {
      const res = await request(app)[method](path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('401: a forged token signed with the wrong secret is refused', async () => {
    // Proves the JWT signature is checked, not just decoded.
    const [header, payload] = tokens.owner!.split('.');
    const res = await request(app)
      .get('/api/profile/me')
      .set({ Authorization: `Bearer ${header}.${payload}.not-the-real-signature` });
    expect(res.status).toBe(401);
  });

  it('400: creating a group with a bad body names the field at fault', async () => {
    // Proves the shared zod schema runs before any SQL, and that the client
    // gets a field name it can highlight.
    const res = await request(app)
      .post('/api/groups')
      .set(auth('owner'))
      .send({ gameId, title: 'x', regionId: EU_WEST, languageId: 1, maxMembers: 99 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.field).toBeTruthy();
  });

  it('400: an availability slot with an impossible time is refused', async () => {
    // Proves availability input is validated before it reaches the CHECKs.
    const res = await request(app)
      .put('/api/profile/me/availability')
      .set(auth('owner'))
      .send([{ dayOfWeek: 1, startLocal: '25:00', endLocal: '26:00' }]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400: a group id that is not a number is refused, not sent to SQL', async () => {
    // Proves path parameters are validated: "/groups/1 OR 1=1" never becomes SQL.
    const res = await request(app).get('/api/groups/1%20OR%201=1').set(auth('owner'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
