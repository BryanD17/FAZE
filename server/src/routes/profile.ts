import { Router } from 'express';
import {
  availabilitySetSchema,
  gameLibraryCreateSchema,
  gameLibraryPatchSchema,
  platformSetSchema,
  profilePatchSchema,
  tagSetSchema,
} from '@faze/shared';

import { profileController } from '../controllers/profile.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validateBody } from '../middleware/validate.js';

export const profileRouter = Router();

profileRouter.get('/me', requireAuth, asyncHandler(profileController.me));

profileRouter.patch(
  '/me',
  requireAuth,
  validateBody(profilePatchSchema),
  asyncHandler(profileController.update),
);

profileRouter.put(
  '/me/platforms',
  requireAuth,
  validateBody(platformSetSchema),
  asyncHandler(profileController.platforms),
);

profileRouter.put(
  '/me/tags',
  requireAuth,
  validateBody(tagSetSchema),
  asyncHandler(profileController.tags),
);

profileRouter.get('/me/games', requireAuth, asyncHandler(profileController.games));

profileRouter.post(
  '/me/games',
  requireAuth,
  validateBody(gameLibraryCreateSchema),
  asyncHandler(profileController.addGame),
);

profileRouter.patch(
  '/me/games/:gameId',
  requireAuth,
  validateBody(gameLibraryPatchSchema),
  asyncHandler(profileController.updateGame),
);

profileRouter.delete('/me/games/:gameId', requireAuth, asyncHandler(profileController.removeGame));

profileRouter.put(
  '/me/availability',
  requireAuth,
  validateBody(availabilitySetSchema),
  asyncHandler(profileController.setAvailability),
);

profileRouter.get('/me/availability', requireAuth, asyncHandler(profileController.availability));

profileRouter.get('/me/completeness', requireAuth, asyncHandler(profileController.completeness));

profileRouter.get('/:displayName', optionalAuth, asyncHandler(profileController.publicProfile));
