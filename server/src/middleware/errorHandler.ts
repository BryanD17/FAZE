import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, ErrorCode } from '../errors.js';

/** Turns any thrown value into the shared error envelope. Never leaks a stack trace or SQL. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, field: err.field, details: err.details },
    });
    return;
  }

  // body-parser errors carry a `type`.
  const type = (err as { type?: string })?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({
      error: {
        code: ErrorCode.INVALID_JSON,
        message: 'The request body is not valid JSON.',
        field: null,
        details: null,
      },
    });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: ErrorCode.PAYLOAD_TOO_LARGE,
        message: 'The request body is too large.',
        field: null,
        details: null,
      },
    });
    return;
  }

  // Unexpected. Log a SUMMARY only: a mysql2 error object carries the full SQL
  // text with its parameters interpolated (a password hash, an email), and the
  // default serializer would write all of it.
  const e = err as { name?: string; code?: string; message?: string };
  req.log?.error(
    { errName: e?.name, errCode: e?.code, errMessage: e?.message?.slice(0, 200) },
    'unhandled error',
  );
  res.status(500).json({
    error: {
      code: ErrorCode.INTERNAL,
      message: 'Something went wrong on our side.',
      field: null,
      details: null,
    },
  });
};

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: ErrorCode.NOT_FOUND, message: 'No such endpoint.', field: null, details: null },
  });
};
