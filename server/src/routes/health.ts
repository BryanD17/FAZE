/**
 * GET /api/health — liveness + database reachability.
 *
 * Returns `{ ok, db }` where `db` is the result of an actual `SELECT 1`. The
 * docker healthcheck, CI and the hosted platform all read this, so it must
 * never be cached and must never throw.
 */
import { Router } from 'express';
import type { HealthResponse } from '@faze/shared';
import { isDatabaseUp } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const up = await isDatabaseUp();
  const body: HealthResponse = { ok: up, db: up ? 'up' : 'down' };
  // A server that is running but cannot reach its database is not healthy;
  // saying so with 503 lets a platform's healthcheck do its job.
  res.status(up ? 200 : 503).json(body);
});
