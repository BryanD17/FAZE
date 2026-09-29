/**
 * Structured logging (pino). `console.log` is a defect in committed server
 * code — it has no level, no request correlation and no redaction.
 *
 * The redaction list is a hard requirement: a password, token or cookie must
 * never reach a log sink, on any code path (AGENT 04 task 9 / rule R10).
 */
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'password',
      'newPassword',
      'passwordHash',
      'password_hash',
      'token',
      'accessToken',
      'refreshToken',
      'tokenHash',
      'token_hash',
      // One level of nesting, e.g. a logged { req: { body } } or { user: {...} }.
      '*.password',
      '*.newPassword',
      '*.passwordHash',
      '*.password_hash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.tokenHash',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
  transport: config.isProduction ? undefined : { target: 'pino/file', options: { destination: 1 } },
});
