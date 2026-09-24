/**
 * Server entry point. Binds the port and shuts the pool down cleanly so a
 * redeploy does not leave connections dangling against a capped provider.
 */
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { closePool } from './db/pool.js';

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'FAZE API listening');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void closePool().then(() => process.exit(0));
    });
  });
}
