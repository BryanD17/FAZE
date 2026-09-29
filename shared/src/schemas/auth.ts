import { z } from 'zod';

/**
 * Request and response shapes for /api/auth/*.
 *
 * These are the single source of truth for BOTH sides: the server validates
 * every request body against them, and the client uses the same schemas for
 * inline form validation, so the rules a user sees are the rules the server
 * enforces. Requests are `.strict()` — an unexpected property is rejected, not
 * silently ignored.
 */

/** Lowercased and trimmed here, so uniqueness never depends on collation behaviour. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(255);

/**
 * At least 10 characters with at least one letter and one digit. No arbitrary
 * symbol rules: length is what resists guessing, and forced symbols mostly
 * produce "Password1!". The 128 cap is a denial-of-service bound on hashing.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use at most 128 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one digit.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters.')
  .max(40, 'Use at most 40 characters.')
  .regex(/^[A-Za-z0-9_.\- ]+$/, 'Use letters, numbers, spaces, dots, dashes and underscores only.');

export const registerRequestSchema = z
  .object({ email: emailSchema, password: passwordSchema, displayName: displayNameSchema })
  .strict();
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

// The sign-in password is deliberately NOT run through passwordSchema: an
// account created before a policy change must still be able to sign in.
export const loginRequestSchema = z
  .object({ email: emailSchema, password: z.string().min(1, 'Enter your password.').max(128) })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

const tokenSchema = z.string().min(20).max(200);

export const verifyEmailRequestSchema = z.object({ token: tokenSchema }).strict();
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const requestPasswordResetSchema = z.object({ email: emailSchema }).strict();
export type RequestPasswordReset = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z
  .object({ token: tokenSchema, newPassword: passwordSchema })
  .strict();
export type ResetPassword = z.infer<typeof resetPasswordSchema>;

export const accountStatusSchema = z.enum(['pending', 'active', 'suspended', 'deleted']);

export const authUserSchema = z.object({
  userId: z.number().int().positive(),
  email: z.string(),
  displayName: z.string(),
  status: accountStatusSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const registerResponseSchema = z.object({
  user: authUserSchema,
  /** false only when the dev-only ALLOW_UNVERIFIED_LOGIN shortcut activated the account immediately. */
  verificationRequired: z.boolean(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

/** The refresh token is NOT in this body — it travels only in an httpOnly cookie. */
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
  user: authUserSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** GET /api/auth/me — the caller's own profile, read from v_user_profile_full. */
export const meResponseSchema = z.object({
  userId: z.number().int().positive(),
  email: z.string(),
  status: accountStatusSchema,
  displayName: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  birthYear: z.number().int().nullable(),
  timezone: z.string(),
  micAvailable: z.boolean(),
  regionCode: z.string().nullable(),
  languageCode: z.string().nullable(),
  platforms: z.array(z.string()),
  tags: z.array(z.string()),
  primaryGameId: z.number().int().nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
