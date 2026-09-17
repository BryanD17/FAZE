/**
 * Boot-time configuration.
 *
 * Convention B.2: `process.env` is read exactly once, here, and validated with
 * zod. A missing or malformed variable fails the process at startup with a
 * readable message instead of surfacing as a confusing runtime error later.
 * No module below this one may touch `process.env`.
 */
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// The repo keeps one .env at the root so the server, the migration runner and
// the ETL scripts all read the same values.
loadDotenv({ path: path.resolve(here, '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1).default('root'),
  DB_PASSWORD: z.string().default('root'),
  DB_NAME: z.string().min(1).default('faze'),
  DB_NAME_TEST: z.string().min(1).default('faze_test'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  clientOrigin: env.CLIENT_ORIGIN,
  logLevel: env.LOG_LEVEL,
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    // Tests run against a separate database so a `db:reset` can never wipe
    // someone's development data mid-suite.
    database: env.NODE_ENV === 'test' ? env.DB_NAME_TEST : env.DB_NAME,
  },
} as const;
