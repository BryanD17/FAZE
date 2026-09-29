/**
 * /api/auth routes: HTTP plumbing and validation only. No SQL, no business
 * rules — those live in services/ and repositories/.
 */
import { Router } from 'express';
import {
  loginRequestSchema,
  registerRequestSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailRequestSchema,
} from '@faze/shared';
import type { AuthController } from '../controllers/auth.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import type { AuthRateLimiters } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validateBody } from '../middleware/validate.js';

export function createAuthRouter(c: AuthController, limits: AuthRateLimiters) {
  const r = Router();
  r.post(
    '/register',
    limits.register,
    validateBody(registerRequestSchema),
    asyncHandler(c.register),
  );
  r.post('/login', limits.signIn, validateBody(loginRequestSchema), asyncHandler(c.signIn));
  r.post('/refresh', asyncHandler(c.refresh));
  r.post('/logout', asyncHandler(c.signOut));
  r.get('/me', requireAuth, asyncHandler(c.me));
  r.post('/verify-email', validateBody(verifyEmailRequestSchema), asyncHandler(c.verifyEmail));
  r.post(
    '/request-password-reset',
    limits.reset,
    validateBody(requestPasswordResetSchema),
    asyncHandler(c.requestPasswordReset),
  );
  r.post(
    '/reset-password',
    limits.reset,
    validateBody(resetPasswordSchema),
    asyncHandler(c.resetPassword),
  );
  return r;
}
