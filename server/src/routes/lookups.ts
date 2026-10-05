import { Router } from 'express';

import { asyncHandler } from '../middleware/asyncHandler.js';
import { getLookups } from '../repositories/lookup.repo.js';

export const lookupsRouter = Router();

lookupsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const lookups = await getLookups();
    res.json(lookups);
  }),
);
