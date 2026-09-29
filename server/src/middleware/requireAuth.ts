import type { RequestHandler } from 'express';
import { AppError, ErrorCode } from '../errors.js';
import { AccessTokenError, verifyAccessToken } from '../services/tokens.js';

/**
 * Requires a valid `Authorization: Bearer <access token>`; attaches
 * `req.user`. The token is verified statelessly (signature + expiry), so a
 * suspension takes effect at the next refresh — at most 15 minutes — not
 * instantly. That trade-off is what makes every authenticated request free of
 * a database lookup.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  const match = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '');
  res.set('WWW-Authenticate', 'Bearer');
  if (!match?.[1]) {
    return next(new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Sign in to continue.'));
  }
  try {
    req.user = verifyAccessToken(match[1]);
    res.removeHeader('WWW-Authenticate');
    next();
  } catch (err) {
    const reason = err instanceof AccessTokenError ? err.reason : 'invalid';
    next(
      new AppError(
        ErrorCode.UNAUTHENTICATED,
        401,
        reason === 'expired' ? 'Your session has expired.' : 'Sign in to continue.',
        null,
        { reason },
      ),
    );
  }
};
