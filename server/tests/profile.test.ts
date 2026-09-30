import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import type { ResultSetHeader } from 'mysql2/promise';

import { localAvailabilityToUtc, utcAvailabilityToLocal } from '@faze/shared';
import { createApp } from '../src/app.js';
import { closePool, pool } from '../src/db/pool.js';
import { signAccessToken } from '../src/services/tokens.js';

const app = createApp();

let userId: number;
let otherUserId: number;
let accessToken: string;
let otherAccessToken: string;

async function createTestUser(email: string, displayName: string): Promise<number> {
  const hash = await argon2.hash('Testing12345');

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO \`user\`
       (email, password_hash, status, email_verified_at)
     VALUES (?, ?, 'active', NOW())`,
    [email, hash],
  );

  await pool.query(
    `INSERT INTO profile
       (user_id, display_name, timezone)
     VALUES (?, ?, 'UTC')`,
    [result.insertId, displayName],
  );

  return result.insertId;
}

beforeAll(async () => {
  await pool.query(
    `DELETE FROM \`user\`
      WHERE email IN ('profile-test@faze.test',
                      'profile-other@faze.test')`,
  );

  userId = await createTestUser('profile-test@faze.test', 'ProfileTest');

  otherUserId = await createTestUser('profile-other@faze.test', 'ProfileOther');

  accessToken = signAccessToken(userId, 'ProfileTest');

  otherAccessToken = signAccessToken(otherUserId, 'ProfileOther');
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM \`user\`
      WHERE user_id IN (?, ?)`,
    [userId, otherUserId],
  );

  await closePool();
});

describe('availability conversion', () => {
  it('round-trips a 22:00-02:00 slot', () => {
    const reference = new Date('2026-01-14T12:00:00Z');

    const local = [
      {
        dayOfWeek: 3,
        startLocal: '22:00',
        endLocal: '02:00',
      },
    ];

    const utc = localAvailabilityToUtc(local, 'UTC', reference);

    expect(utc).toHaveLength(2);

    const roundTrip = utcAvailabilityToLocal(utc, 'UTC', reference);

    expect(roundTrip).toEqual(local);
  });

  it('converts Asia/Tokyo correctly', () => {
    const reference = new Date('2026-01-14T12:00:00Z');

    const utc = localAvailabilityToUtc(
      [
        {
          dayOfWeek: 6,
          startLocal: '21:00',
          endLocal: '24:00',
        },
      ],
      'Asia/Tokyo',
      reference,
    );

    expect(utc.length).toBeGreaterThan(0);
  });

  it('handles a Los Angeles DST transition week', () => {
    const reference = new Date('2026-03-08T18:00:00Z');

    const utc = localAvailabilityToUtc(
      [
        {
          dayOfWeek: 0,
          startLocal: '18:00',
          endLocal: '20:00',
        },
      ],
      'America/Los_Angeles',
      reference,
    );

    const local = utcAvailabilityToLocal(utc, 'America/Los_Angeles', reference);

    expect(local).toEqual([
      {
        dayOfWeek: 0,
        startLocal: '18:00',
        endLocal: '20:00',
      },
    ]);
  });

  it('merges adjacent slots', () => {
    const reference = new Date('2026-01-14T12:00:00Z');

    const utc = localAvailabilityToUtc(
      [
        {
          dayOfWeek: 2,
          startLocal: '18:00',
          endLocal: '20:00',
        },
        {
          dayOfWeek: 2,
          startLocal: '20:00',
          endLocal: '22:00',
        },
      ],
      'UTC',
      reference,
    );

    expect(utc).toEqual([
      {
        dayOfWeek: 2,
        startMinute: 1080,
        endMinute: 1320,
      },
    ]);
  });
});

describe('profile API', () => {
  it('replaces platforms transactionally', async () => {
    await request(app)
      .put('/api/profile/me/platforms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ platformIds: [1, 2] })
      .expect(200);

    await request(app)
      .put('/api/profile/me/platforms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ platformIds: [1, 999] })
      .expect(422);

    const [rows] = await pool.query(
      `SELECT platform_id
         FROM user_platform
        WHERE user_id = ?
        ORDER BY platform_id`,
      [userId],
    );

    expect(rows).toMatchObject([{ platform_id: 1 }, { platform_id: 2 }]);
  });

  it('enforces at most five tags', async () => {
    const response = await request(app)
      .put('/api/profile/me/tags')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ tagIds: [1, 2, 3, 4, 5, 6] });

    expect(response.status).toBe(400);
  });

  it('redacts email and exact availability publicly', async () => {
    await request(app)
      .put('/api/profile/me/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .send([
        {
          dayOfWeek: 6,
          startLocal: '18:00',
          endLocal: '22:00',
        },
      ])
      .expect(200);

    const response = await request(app)
      .get('/api/profile/ProfileTest')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .expect(200);

    expect(response.body.email).toBeUndefined();
    expect(response.body.birthYear).toBeUndefined();
    expect(response.body.availability).toBeNull();
    expect(response.body.availabilitySummary).toContain('weekends');
  });

  it('completeness reaches 100 only with all five pieces', async () => {
    let response = await request(app)
      .get('/api/profile/me/completeness')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.body.score).toBeLessThan(100);

    await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ regionId: 1 })
      .expect(200);

    await request(app)
      .put('/api/profile/me/platforms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ platformIds: [1] })
      .expect(200);

    await request(app)
      .put('/api/profile/me/tags')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ tagIds: [1] })
      .expect(200);

    await request(app)
      .put('/api/profile/me/availability')
      .set('Authorization', `Bearer ${accessToken}`)
      .send([
        {
          dayOfWeek: 1,
          startLocal: '18:00',
          endLocal: '20:00',
        },
      ])
      .expect(200);

    const [game] = await pool.query<ResultSetHeader>(
      `INSERT INTO game
         (title, slug, is_multiplayer)
       VALUES ('Profile Test Game',
               CONCAT('profile-test-game-', ?),
               1)`,
      [userId],
    );

    await request(app)
      .post('/api/profile/me/games')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        gameId: game.insertId,
        goal: 'casual',
        isPrimary: true,
      })
      .expect(201);

    response = await request(app)
      .get('/api/profile/me/completeness')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.score).toBe(100);
    expect(response.body.missing).toEqual([]);

    await pool.query(
      `DELETE FROM user_game
        WHERE user_id = ? AND game_id = ?`,
      [userId, game.insertId],
    );

    await pool.query('DELETE FROM game WHERE game_id = ?', [game.insertId]);
  });
});
