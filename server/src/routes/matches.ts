import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { findMatches } from '../repositories/match.repo.js';

export const matchesRouter = Router();

// Groups ranked for the signed-in user. The ranking is one SQL query; see
// match.repo.ts and docs/matchmaking.md.
matchesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const matches = await findMatches(req.user!.userId);
    res.json({ matches });
  }),
);
