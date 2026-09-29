/**
 * Express application wiring. Kept separate from `index.ts` so tests can mount
 * the app with supertest without binding a port, and so a test can inject a
 * capturing Mailer or a tiny rate limit instead of the production defaults.
 */
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { createAuthController } from './controllers/auth.controller.js';
import { logger } from './logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { createAuthRateLimiters } from './middleware/rateLimit.js';
import type { AuthRateLimits } from './middleware/rateLimit.js';
import { createAuthRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { createAuthService } from './services/auth.service.js';
import { createDefaultMailer } from './services/mailer.js';
import type { Mailer } from './services/mailer.js';

export interface AppOptions {
  mailer?: Mailer;
  allowUnverifiedLogin?: boolean;
  rateLimits?: Partial<AuthRateLimits>;
  now?: () => Date;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: config.clientOrigin,
      // The refresh token travels in an httpOnly cookie, so the browser must
      // be allowed to send credentials cross-origin.
      credentials: true,
    }),
  );
  // A body limit is a denial-of-service control, not a formality.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  const authService = createAuthService({
    mailer: opts.mailer ?? createDefaultMailer(),
    allowUnverifiedLogin: opts.allowUnverifiedLogin ?? config.auth.allowUnverifiedLogin,
    now: opts.now,
  });

  app.use('/api', healthRouter);
  app.use(
    '/api/auth',
    createAuthRouter(createAuthController(authService), createAuthRateLimiters(opts.rateLimits)),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
