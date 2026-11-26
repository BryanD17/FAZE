import {
  ratingCreateSchema,
  scheduleSessionSchema,
  type CreateRating,
  type ScheduleSession,
} from '@faze/shared';
import { Router } from 'express';

import { AppError, ErrorCode } from '../errors.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupRole } from '../middleware/requireGroupRole.js';
import { validateBody } from '../middleware/validate.js';
import { findActiveRole } from '../repositories/membership.repo.js';
import {
  findSession,
  insertRating,
  insertSession,
  listSessions,
  markSessionPlayed,
} from '../repositories/session.repo.js';
import { parseGroupId } from '../services/group.service.js';

export const sessionsRouter = Router();

function parseSessionId(raw: string | undefined): number {
  const id = Number(raw);
  if (!/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(id) || id <= 0) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      400,
      'Session id must be a positive integer.',
      'id',
    );
  }
  return id;
}

function sessionNotFound(): never {
  throw new AppError(ErrorCode.SESSION_NOT_FOUND, 404, 'That session does not exist.');
}

function forbiddenGroupRole(): never {
  throw new AppError(
    ErrorCode.FORBIDDEN_GROUP_ROLE,
    403,
    'You do not have permission to do that in this group.',
  );
}

function databaseErrorField(err: unknown, field: string): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const value = (err as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function throwRatingError(err: unknown): never {
  const code = databaseErrorField(err, 'code');
  const sqlState = databaseErrorField(err, 'sqlState');
  const sqlMessage = databaseErrorField(err, 'sqlMessage');

  if (sqlState === '45000') {
    throw new AppError(
      ErrorCode.RATING_REJECTED,
      409,
      sqlMessage ?? 'That rating is not allowed.',
    );
  }
  if (code === 'ER_DUP_ENTRY') {
    throw new AppError(
      ErrorCode.ALREADY_RATED,
      409,
      'You already rated this teammate for this session.',
    );
  }
  if (code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    throw new AppError(ErrorCode.RATING_REJECTED, 409, 'That rating is not allowed.');
  }
  throw err;
}

sessionsRouter.get(
  '/groups/:id/sessions',
  requireAuth,
  requireGroupRole('member'),
  asyncHandler(async (req, res) => {
    const groupId = parseGroupId(req.params.id);
    res.status(200).json({ sessions: await listSessions(groupId) });
  }),
);

sessionsRouter.post(
  '/groups/:id/sessions',
  requireAuth,
  requireGroupRole('member'),
  validateBody(scheduleSessionSchema),
  asyncHandler(async (req, res) => {
    const groupId = parseGroupId(req.params.id);
    const { startsAt } = req.body as ScheduleSession;
    res.status(201).json(await insertSession(groupId, new Date(startsAt)));
  }),
);

sessionsRouter.post(
  '/sessions/:id/played',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.id);
    const session = await findSession(sessionId);
    if (!session) sessionNotFound();

    const role = await findActiveRole(session.groupId, req.user!.userId);
    if (role !== 'owner') forbiddenGroupRole();

    await markSessionPlayed(sessionId);
    res.status(200).json(await findSession(sessionId));
  }),
);

sessionsRouter.post(
  '/sessions/:id/ratings',
  requireAuth,
  validateBody(ratingCreateSchema),
  asyncHandler(async (req, res) => {
    const sessionId = parseSessionId(req.params.id);
    if (!(await findSession(sessionId))) sessionNotFound();

    const { rateeUserId, score } = req.body as CreateRating;
    try {
      await insertRating(sessionId, req.user!.userId, rateeUserId, score);
    } catch (err) {
      throwRatingError(err);
    }
    res.status(201).json({ ok: true });
  }),
);
