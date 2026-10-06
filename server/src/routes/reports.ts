import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getSummary } from '../repositories/report.repo.js';

export const reportsRouter = Router();

// Read-only database snapshot for the "database stats" page.
reportsRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await getSummary());
  }),
);
