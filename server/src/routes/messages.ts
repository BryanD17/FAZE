import { Router } from 'express';
import {
  messageCreateSchema,
  messageListQuerySchema,
  type CreateMessage,
  type MessageListQuery,
} from '@faze/shared';

import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupRole } from '../middleware/requireGroupRole.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { insertMessage, listMessages } from '../repositories/message.repo.js';
import { parseGroupId } from '../services/group.service.js';

export const messagesRouter = Router();

messagesRouter.get(
  '/:id/messages',
  requireAuth,
  requireGroupRole('member'),
  validateQuery(messageListQuerySchema),
  asyncHandler(async (req, res) => {
    const groupId = parseGroupId(req.params.id);
    const { limit, beforeId } = req.query as unknown as MessageListQuery;

    const messages = await listMessages(groupId, limit, beforeId);

    res.status(200).json({ messages });
  }),
);

messagesRouter.post(
  '/:id/messages',
  requireAuth,
  requireGroupRole('member'),
  validateBody(messageCreateSchema),
  asyncHandler(async (req, res) => {
    const groupId = parseGroupId(req.params.id);
    const { body } = req.body as CreateMessage;

    const message = await insertMessage(groupId, req.user!.userId, body);

    res.status(201).json(message);
  }),
);
