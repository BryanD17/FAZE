import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError, ErrorCode } from '../errors.js';

export interface LimitOptions {
  windowMs: number;
  limit: number;
}

export interface AuthRateLimits {
  register: LimitOptions;
  signIn: LimitOptions;
  reset: LimitOptions;
}

/** 5 attempts per 15 minutes per IP (AGENT 04 task 8). */
export const DEFAULT_AUTH_LIMITS: AuthRateLimits = {
  register: { windowMs: 15 * 60 * 1000, limit: 5 },
  signIn: { windowMs: 15 * 60 * 1000, limit: 5 },
  reset: { windowMs: 15 * 60 * 1000, limit: 5 },
};

function limiter(opts: LimitOptions, skipSuccessfulRequests = false): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (req, res, next) => {
      const resetTime = (req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const retryAfter = Math.max(
        1,
        Math.ceil(((resetTime?.getTime() ?? Date.now()) - Date.now()) / 1000),
      );
      res.set('Retry-After', String(retryAfter));
      next(
        new AppError(ErrorCode.RATE_LIMITED, 429, 'Too many attempts. Try again later.', null, {
          retryAfterSeconds: retryAfter,
        }),
      );
    },
  });
}

/**
 * Sign-in counts only FAILED attempts. That is what stops password guessing,
 * and it keeps a shared IP — a classroom, a campus, or the single proxy
 * address in front of a hosted demo — from being locked out by its own
 * successful sign-ins. Registration and reset count every request, since
 * those are the mass-signup and email-flooding vectors.
 */
export function createAuthRateLimiters(overrides: Partial<AuthRateLimits> = {}) {
  const limits = { ...DEFAULT_AUTH_LIMITS, ...overrides };
  return {
    register: limiter(limits.register),
    signIn: limiter(limits.signIn, true),
    reset: limiter(limits.reset),
  };
}

export type AuthRateLimiters = ReturnType<typeof createAuthRateLimiters>;
