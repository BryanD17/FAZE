/**
 * HTTP <-> service translation for /api/auth. No business rules here: it reads
 * the (already validated) request, calls the service, and shapes the response
 * — including the refresh-token cookie, which is the one thing that must
 * never appear in a response body.
 */
import type { CookieOptions, Request, Response } from 'express';
import type {
  LoginRequest,
  RegisterRequest,
  RequestPasswordReset,
  ResetPassword,
  VerifyEmailRequest,
} from '@faze/shared';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import type { AuthService, SessionResult } from '../services/auth.service.js';

export const REFRESH_COOKIE = 'faze_refresh';

// httpOnly: script cannot read it. SameSite=Lax: not sent on cross-site POSTs.
// path: only the auth endpoints ever receive it, not every API call.
const baseCookie: CookieOptions = {
  httpOnly: true,
  secure: config.auth.cookieSecure,
  sameSite: 'lax',
  path: '/api/auth',
};

const userAgentOf = (req: Request): string | null => req.get('user-agent')?.slice(0, 255) ?? null;
const refreshCookieOf = (req: Request): string | undefined => {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof v === 'string' ? v : undefined;
};

function sendSession(res: Response, s: SessionResult) {
  res.cookie(REFRESH_COOKIE, s.refreshToken, { ...baseCookie, maxAge: s.refreshMaxAgeMs });
  res.status(200).json({
    accessToken: s.accessToken,
    tokenType: 'Bearer',
    expiresIn: s.expiresIn,
    user: s.user,
  });
}

export function createAuthController(service: AuthService) {
  return {
    async register(req: Request, res: Response) {
      res.status(201).json(await service.register(req.body as RegisterRequest));
    },

    async signIn(req: Request, res: Response) {
      const body = req.body as LoginRequest;
      sendSession(res, await service.signIn(body.email, body.password, userAgentOf(req)));
    },

    async refresh(req: Request, res: Response) {
      try {
        sendSession(res, await service.refresh(refreshCookieOf(req), userAgentOf(req)));
      } catch (err) {
        // A refresh that fails leaves the browser holding a cookie that will
        // never work again; drop it so the client stops retrying with it.
        if (err instanceof AppError) res.clearCookie(REFRESH_COOKIE, baseCookie);
        throw err;
      }
    },

    async signOut(req: Request, res: Response) {
      await service.signOut(refreshCookieOf(req));
      res.clearCookie(REFRESH_COOKIE, baseCookie);
      res.status(204).end();
    },

    async me(req: Request, res: Response) {
      // requireAuth guarantees req.user.
      res.status(200).json(await service.me(req.user!.userId));
    },

    async verifyEmail(req: Request, res: Response) {
      await service.verifyEmail((req.body as VerifyEmailRequest).token);
      res.status(200).json({ ok: true });
    },

    async requestPasswordReset(req: Request, res: Response) {
      await service.requestPasswordReset((req.body as RequestPasswordReset).email);
      // 202 and an identical body whether or not the address has an account.
      res.status(202).json({ ok: true });
    },

    async resetPassword(req: Request, res: Response) {
      const body = req.body as ResetPassword;
      await service.resetPassword(body.token, body.newPassword);
      res.status(200).json({ ok: true });
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
