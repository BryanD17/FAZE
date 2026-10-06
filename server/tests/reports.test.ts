import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ResultSetHeader } from 'mysql2/promise';

import { createApp } from '../src/app.js';
import { closePool, pool } from '../src/db/pool.js';
import { signAccessToken } from '../src/services/tokens.js';

const app = createApp();
const EMAIL = 'reader@report-test.faze';
const SLUG = 'report-test-game';

let token: string;

beforeAll(async () => {
  await pool.query('DELETE FROM `user` WHERE email = ?', [EMAIL]);
  await pool.query('DELETE FROM game WHERE slug = ?', [SLUG]);

  const [user] = await pool.query<ResultSetHeader>(
    `INSERT INTO \`user\` (email, password_hash, status, email_verified_at)
     VALUES (?, 'not-a-real-hash', 'active', NOW())`,
    [EMAIL],
  );
  await pool.query(
    `INSERT INTO profile (user_id, display_name, timezone) VALUES (?, 'report-reader', 'UTC')`,
    [user.insertId],
  );
  const [game] = await pool.query<ResultSetHeader>(
    `INSERT INTO game (title, slug, is_multiplayer) VALUES ('Report Test Game', ?, 1)`,
    [SLUG],
  );
  // One person has the game in their library, so it counts as "searched for".
  await pool.query('INSERT INTO user_game (user_id, game_id) VALUES (?, ?)', [
    user.insertId,
    game.insertId,
  ]);

  token = signAccessToken(user.insertId, 'report-reader');
});

afterAll(async () => {
  await pool.query('DELETE FROM `user` WHERE email = ?', [EMAIL]);
  await pool.query('DELETE FROM game WHERE slug = ?', [SLUG]);
  await closePool();
});

describe('GET /api/reports/summary', () => {
  it('returns totals, zero member-count drift and the popular games', async () => {
    const { body } = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(body.totals.users).toBeGreaterThanOrEqual(1);
    expect(body.totals.games).toBeGreaterThanOrEqual(1);
    expect(body.memberCountDrift).toBe(0);
    expect(body.popularGames.length).toBeLessThanOrEqual(10);
    expect(body.popularGames).toContainEqual({
      gameId: expect.any(Number),
      title: 'Report Test Game',
      activeGroups: 0,
      searchingUsers: 1,
    });
  });

  it('requires a signed-in user', async () => {
    await request(app).get('/api/reports/summary').expect(401);
  });
});
