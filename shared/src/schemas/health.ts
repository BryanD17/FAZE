import { z } from 'zod';

/**
 * `GET /api/health` — the liveness probe used by CI, docker healthchecks and
 * the hosted platform. `db` reflects an actual `SELECT 1` round trip, not a
 * cached flag, so a healthy response genuinely means the database is reachable.
 */
export const healthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.enum(['up', 'down']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
