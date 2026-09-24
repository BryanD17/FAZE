import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';

const app = createApp();

afterAll(async () => {
  await closePool();
});

describe('GET /api/health', () => {
  it('reports the real database state from a SELECT 1 round trip', async () => {
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('ok');
    expect(['up', 'down']).toContain(res.body.db);
    // ok and db must agree — a truthy ok with db:"down" would mean the probe
    // is lying to the platform healthcheck.
    expect(res.body.ok).toBe(res.body.db === 'up');
  });
});

describe('unknown routes', () => {
  it('returns the standard error envelope, never an HTML stack trace', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error).toHaveProperty('field');
  });
});
