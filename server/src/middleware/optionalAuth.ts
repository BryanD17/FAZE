import type { RequestHandler } from 'express';

import { verifyAccessToken } from '../services/tokens.js';

export const optionalAuth: RequestHandler = (req, _res, next) => {
  const match = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '');

  if (!match?.[1]) {
    next();
    return;
  }

  try {
    req.user = verifyAccessToken(match[1]);
  } catch {
    // Public profile stays public. An invalid optional token is treated as
    // anonymous rather than turning the endpoint into an authenticated one.
  }

  next();
};
