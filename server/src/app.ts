/**
 * Express application wiring. Kept separate from `index.ts` so tests can mount
 * the app with supertest without binding a port.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { healthRouter } from './routes/health.js';

export function createApp() {
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
  app.use(pinoHttp({ logger }));

  app.use('/api', healthRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'No such endpoint.', field: null, details: null },
    });
  });

  return app;
}
