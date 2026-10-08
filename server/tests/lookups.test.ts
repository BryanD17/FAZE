import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';

const app = createApp();

afterAll(async () => {
  await closePool();
});

describe('GET /api/lookups', () => {
  it('returns the reference lists used by profile and group forms', async () => {
    const response = await request(app).get('/api/lookups').expect(200);

    expect(response.body.regions.length).toBeGreaterThanOrEqual(8);
    expect(response.body.platforms.length).toBeGreaterThanOrEqual(5);
    expect(response.body.languages.length).toBeGreaterThan(0);
    expect(response.body.tags.length).toBeGreaterThan(0);

    expect(response.body.regions[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        code: expect.any(String),
      }),
    );

    expect(response.body.languages[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        code: expect.any(String),
      }),
    );

    expect(response.body.platforms[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        slug: expect.any(String),
      }),
    );

    expect(response.body.tags[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        slug: expect.any(String),
      }),
    );
  });
});
