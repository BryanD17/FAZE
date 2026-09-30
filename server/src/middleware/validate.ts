import type { RequestHandler } from 'express';
import type { z } from 'zod';

import { AppError, ErrorCode } from '../errors.js';

function validationError(result: z.SafeParseError<unknown>) {
  const issues = result.error.issues.map((i) => ({
    field: i.path.length ? String(i.path[0]) : null,
    message: i.message,
  }));

  const first = issues[0];

  return new AppError(
    ErrorCode.VALIDATION_ERROR,
    400,
    first?.message ?? 'The request is invalid.',
    first?.field ?? null,
    { issues },
  );
}

export function validateBody(schema: z.ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(validationError(result));
      return;
    }

    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: z.ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      next(validationError(result));
      return;
    }

    Object.assign(req.query, result.data);
    next();
  };
}
