import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError, ErrorCode } from '../errors.js';

/**
 * Validates `req.body` against a shared zod schema BEFORE any controller runs
 * (convention B.2: unvalidated `req.body` access is a defect). On success the
 * parsed value replaces the body, so the controller sees trimmed/lowercased
 * data and never the raw input. On failure the first issue names the `field`
 * so the client can highlight the offending input.
 */
export function validateBody(schema: z.ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (result.success) {
      req.body = result.data;
      return next();
    }
    const issues = result.error.issues.map((i) => ({
      field: i.path.length ? String(i.path[0]) : null,
      message: i.message,
    }));
    const first = issues[0];
    next(
      new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        first?.message ?? 'The request is invalid.',
        first?.field ?? null,
        { issues },
      ),
    );
  };
}
