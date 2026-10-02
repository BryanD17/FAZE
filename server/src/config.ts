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

  // Signs the 15-minute access token. Required, and long enough that it cannot
  // be guessed: a short secret would let anyone forge a token for any user.
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters (openssl rand -base64 48)')
    // .env.example ships a placeholder long enough to pass the length check.
    // Booting with it would mean signing tokens with a secret that is public.
    .refine(
      (v) => !v.startsWith('replace-me'),
      'is still the .env.example placeholder; generate a real one',
    ),

  // Activate accounts at registration instead of waiting for an emailed link.
  // The class project has no mail provider, so this is how people sign in.
  // In production it additionally needs DEMO_MODE=true (see below).
  ALLOW_UNVERIFIED_LOGIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Explicit opt-in that lets a deployed demo skip email verification.
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // The refresh cookie is `Secure`. Browsers accept that on http://localhost
  // (Chrome, Edge, Firefox) but Safari does not; set false to develop in Safari.
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
}

const env = parsed.data;

// Skipping email verification in production must be a deliberate choice.
if (env.NODE_ENV === 'production' && env.ALLOW_UNVERIFIED_LOGIN && !env.DEMO_MODE) {
  throw new Error(
    'ALLOW_UNVERIFIED_LOGIN=true in production also requires DEMO_MODE=true (a deliberate demo deployment).',
  );
}

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
  auth: {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessTtlSeconds: 15 * 60,
    refreshTtlSeconds: 30 * 24 * 60 * 60,
    verificationTtlSeconds: 24 * 60 * 60,
    passwordResetTtlSeconds: 60 * 60,
    allowUnverifiedLogin: env.ALLOW_UNVERIFIED_LOGIN,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : true,
  },
} as const;
