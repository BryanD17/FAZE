/**
 * Authentication business rules. No SQL here (repositories own that) and no
 * HTTP here (controllers own that): this layer decides what is allowed.
 *
 * Multi-table writes run inside `withTransaction` (rule R9). Decisions that
 * must survive a failure — notably revoking every token after a reuse is
 * detected — are made INSIDE the transaction and the error is thrown AFTER it
 * commits; throwing from inside would roll the revocation back.
 */
import type { AuthUser, MeResponse, RegisterRequest } from '@faze/shared';
import { config } from '../config.js';
import { withTransaction } from '../db/pool.js';
import { AppError, ErrorCode } from '../errors.js';
import * as tokenRepo from '../repositories/token.repo.js';
import * as userRepo from '../repositories/user.repo.js';
import type { AuthUserRow, Db } from '../repositories/user.repo.js';
import type { Mailer } from './mailer.js';
import { dummyHash, hashPassword, verifyPassword } from './passwords.js';
import { hashToken, newOpaqueToken, signAccessToken } from './tokens.js';

export interface AuthServiceDeps {
  mailer: Mailer;
  /** Development shortcut. Never true in production (config refuses to boot). */
  allowUnverifiedLogin: boolean;
  /** Injectable clock so expiry is testable without sleeping. */
  now?: () => Date;
}

export interface SessionResult {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
  /** The raw refresh token. Goes into an httpOnly cookie, never into a response body. */
  refreshToken: string;
  refreshMaxAgeMs: number;
}

const seconds = (n: number) => n * 1000;

function toAuthUser(u: AuthUserRow): AuthUser {
  return { userId: u.userId, email: u.email, displayName: u.displayName, status: u.status };
}

/** Which key a MySQL duplicate-entry error refers to, or null if it is not one we map. */
function duplicateField(err: unknown): 'email' | 'displayName' | null {
  const e = err as { code?: string; sqlMessage?: string };
  if (e?.code !== 'ER_DUP_ENTRY') return null;
  if (e.sqlMessage?.includes('uq_user_email')) return 'email';
  if (e.sqlMessage?.includes('uq_profile_display_name')) return 'displayName';
  return null;
}

export function createAuthService(deps: AuthServiceDeps) {
  const clock = deps.now ?? (() => new Date());
  const allowUnverified = deps.allowUnverifiedLogin && !config.isProduction;

  /** Why this account may not sign in, or null if it may. */
  function statusError(user: AuthUserRow): AppError | null {
    if (user.status === 'suspended') {
      return new AppError(ErrorCode.ACCOUNT_SUSPENDED, 403, 'This account has been suspended.');
    }
    if (user.status === 'deleted') {
      return new AppError(ErrorCode.ACCOUNT_DELETED, 403, 'This account has been deleted.');
    }
    if (user.status === 'pending' && !allowUnverified) {
      return new AppError(
        ErrorCode.EMAIL_NOT_VERIFIED,
        403,
        'Verify your email address to sign in. Check your inbox for the link.',
      );
    }
    return null;
  }

  /** Inserts a fresh refresh-token row and mints the matching access token. */
  async function issueSession(
    db: Db,
    user: AuthUserRow,
    userAgent: string | null,
  ): Promise<SessionResult> {
    const refresh = newOpaqueToken();
    const expiresAt = new Date(clock().getTime() + seconds(config.auth.refreshTtlSeconds));
    await tokenRepo.insertRefreshToken(
      { tokenHash: refresh.hash, userId: user.userId, expiresAt, userAgent },
      db,
    );
    return {
      accessToken: signAccessToken(user.userId, user.displayName),
      expiresIn: config.auth.accessTtlSeconds,
      user: toAuthUser(user),
      refreshToken: refresh.token,
      refreshMaxAgeMs: seconds(config.auth.refreshTtlSeconds),
    };
  }

  return {
    async register(input: RegisterRequest) {
      // Hash BEFORE touching the database so a duplicate email and a duplicate
      // display name both cost the same ~hash time, and the response timing
      // does not reveal which field collided.
      const passwordHash = await hashPassword(input.password);
      const verification = newOpaqueToken();
      const now = clock();
      const status = allowUnverified ? 'active' : 'pending';

      let userId: number;
      try {
        userId = await withTransaction(async (conn) => {
          const id = await userRepo.insertUser({ email: input.email, passwordHash, status }, conn);
          await userRepo.insertProfile({ userId: id, displayName: input.displayName }, conn);
          await tokenRepo.insertEmailVerification(
            {
              tokenHash: verification.hash,
              userId: id,
              expiresAt: new Date(now.getTime() + seconds(config.auth.verificationTtlSeconds)),
            },
            conn,
          );
          return id;
        });
      } catch (err) {
        const field = duplicateField(err);
        if (field === 'email') {
          throw new AppError(
            ErrorCode.EMAIL_TAKEN,
            409,
            'An account with this email already exists.',
            'email',
          );
        }
        if (field === 'displayName') {
          throw new AppError(
            ErrorCode.DISPLAY_NAME_TAKEN,
            409,
            'That display name is taken.',
            'displayName',
          );
        }
        throw err;
      }

      // Sent after the commit: a mail failure must not undo a created account.
      await deps.mailer.sendVerification(
        input.email,
        `${config.clientOrigin}/verify-email?token=${verification.token}`,
      );

      return {
        user: { userId, email: input.email, displayName: input.displayName, status } as AuthUser,
        verificationRequired: !allowUnverified,
      };
    },

    /** Verifies credentials and opens a session. */
    async signIn(email: string, plain: string, userAgent: string | null): Promise<SessionResult> {
      const user = await userRepo.findAuthByEmail(email);
      // Always run a full verification, against a dummy hash when the account
      // does not exist, so an unknown email and a wrong secret take the same time.
      const matches = await verifyPassword(user ? user.passwordHash : await dummyHash(), plain);
      if (!user || !matches) {
        throw new AppError(ErrorCode.INVALID_CREDENTIALS, 401, 'Incorrect email or password.');
      }
      // Status is checked only AFTER the secret is proven, so an attacker
      // cannot use this endpoint to learn which accounts are suspended.
      const blocked = statusError(user);
      if (blocked) throw blocked;

      return withTransaction(async (conn) => {
        const session = await issueSession(conn, user, userAgent);
        await userRepo.recordSignIn(user.userId, clock(), conn);
        return session;
      });
    },

    async refresh(rawToken: string | undefined, userAgent: string | null): Promise<SessionResult> {
      if (!rawToken) {
        throw new AppError(ErrorCode.INVALID_REFRESH_TOKEN, 401, 'Sign in to continue.');
      }
      const hash = hashToken(rawToken);

      type Outcome =
        | { kind: 'ok'; session: SessionResult }
        | { kind: 'invalid' }
        | { kind: 'expired' }
        | { kind: 'reused' }
        | { kind: 'blocked'; error: AppError };

      const outcome = await withTransaction<Outcome>(async (conn) => {
        const row = await tokenRepo.lockRefreshToken(hash, conn);
        if (!row) return { kind: 'invalid' };
        const now = clock();

        if (row.revokedAt) {
          // An already-spent token is being presented again: either a stolen
          // copy is being replayed, or the legitimate client raced itself.
          // Either way the only safe move is to end every session for the user.
          await tokenRepo.revokeAllRefreshTokensForUser(row.userId, now, conn);
          return { kind: 'reused' };
        }
        if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };

        const user = await userRepo.findAuthById(row.userId, conn);
        if (!user) return { kind: 'invalid' };
        const blocked = statusError(user);
        if (blocked) {
          await tokenRepo.revokeAllRefreshTokensForUser(user.userId, now, conn);
          return { kind: 'blocked', error: blocked };
        }

        await tokenRepo.revokeRefreshToken(hash, now, conn);
        return { kind: 'ok', session: await issueSession(conn, user, userAgent) };
      });

      switch (outcome.kind) {
        case 'ok':
          return outcome.session;
        case 'blocked':
          throw outcome.error;
        case 'reused':
          throw new AppError(
            ErrorCode.REFRESH_TOKEN_REUSED,
            401,
            'This session is no longer valid. Sign in again.',
          );
        default:
          throw new AppError(ErrorCode.INVALID_REFRESH_TOKEN, 401, 'Sign in to continue.');
      }
    },

    /** Idempotent: an unknown or already-revoked token is not an error, the goal state is reached. */
    async signOut(rawToken: string | undefined): Promise<void> {
      if (!rawToken) return;
      await tokenRepo.revokeRefreshToken(hashToken(rawToken), clock());
    },

    async me(userId: number): Promise<MeResponse> {
      const profile = await userRepo.findProfileFull(userId);
      if (!profile || profile.status === 'deleted') {
        throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Sign in to continue.');
      }
      return profile;
    },

    async verifyEmail(rawToken: string): Promise<void> {
      const hash = hashToken(rawToken);
      const ok = await withTransaction(async (conn) => {
        const row = await tokenRepo.lockEmailVerification(hash, conn);
        const now = clock();
        if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return false;
        await tokenRepo.markEmailVerificationUsed(hash, now, conn);
        await userRepo.markEmailVerified(row.userId, now, conn);
        return true;
      });
      if (!ok) throw invalidToken();
    },

    /**
     * Always resolves the same way whether or not the address has an account,
     * so this endpoint cannot be used to discover who is registered.
     */
    async requestPasswordReset(email: string): Promise<void> {
      const user = await userRepo.findAuthByEmail(email);
      if (!user || user.status === 'deleted') return;

      const reset = newOpaqueToken();
      const now = clock();
      await withTransaction(async (conn) => {
        await tokenRepo.retireUnusedPasswordResets(user.userId, now, conn);
        await tokenRepo.insertPasswordReset(
          {
            tokenHash: reset.hash,
            userId: user.userId,
            expiresAt: new Date(now.getTime() + seconds(config.auth.passwordResetTtlSeconds)),
          },
          conn,
        );
      });
      await deps.mailer.sendPasswordReset(
        user.email,
        `${config.clientOrigin}/reset-password?token=${reset.token}`,
      );
    },

    async resetPassword(rawToken: string, newPlain: string): Promise<void> {
      // Hashed before the token is even looked up, so a bad token and a good
      // one cost the same.
      const newHash = await hashPassword(newPlain);
      const hash = hashToken(rawToken);
      const ok = await withTransaction(async (conn) => {
        const row = await tokenRepo.lockPasswordReset(hash, conn);
        const now = clock();
        if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return false;
        await userRepo.setPasswordHash(row.userId, newHash, conn);
        // Spends this token and retires any other outstanding one.
        await tokenRepo.retireUnusedPasswordResets(row.userId, now, conn);
        // A reset means the old secret may be compromised: end every session.
        await tokenRepo.revokeAllRefreshTokensForUser(row.userId, now, conn);
        return true;
      });
      if (!ok) throw invalidToken();
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

const invalidToken = () =>
  new AppError(
    ErrorCode.INVALID_OR_EXPIRED_TOKEN,
    400,
    'This link is invalid or has expired. Request a new one.',
  );
