import { Router } from 'express';
import { gameSearchQuerySchema } from '@faze/shared';

import { gameController } from '../controllers/game.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateQuery } from '../middleware/validate.js';

export const gamesRouter = Router();

gamesRouter.get(
  '/search',
  validateQuery(gameSearchQuerySchema),
  asyncHandler(gameController.search),
);

gamesRouter.get('/popular', asyncHandler(gameController.popular));
