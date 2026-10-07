import { Router } from 'express';
import { createGroupSchema, groupListQuerySchema } from '@faze/shared';

import { groupController } from '../controllers/group.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';

export const groupsRouter = Router();

groupsRouter.get(
  '/',
  requireAuth,
  validateQuery(groupListQuerySchema),
  asyncHandler(groupController.list),
);

groupsRouter.post(
  '/',
  requireAuth,
  validateBody(createGroupSchema),
  asyncHandler(groupController.create),
);

groupsRouter.get('/:id', requireAuth, asyncHandler(groupController.detail));

groupsRouter.post('/:id/join', requireAuth, asyncHandler(groupController.join));

groupsRouter.post('/:id/leave', requireAuth, asyncHandler(groupController.leave));
