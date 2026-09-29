/**
 * Opaque tokens (refresh / email verification / password reset) and the
 * signed access token.
 *
 * Opaque tokens are 32 random bytes; only their SHA-256 is ever stored, so a
 * database leak cannot be replayed. The access token is a short-lived JWT
 * (HS256, 15 minutes): verified statelessly on every request, which is why it
 * must stay short — a suspension takes effect at the next refresh, not
 * instantly.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newOpaqueToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function signAccessToken(userId: number, displayName: string): string {
  return jwt.sign({ displayName }, config.auth.accessSecret, {
    algorithm: 'HS256',
    subject: String(userId),
    expiresIn: config.auth.accessTtlSeconds,
  });
}

export type AccessClaims = { userId: number; displayName: string };

export class AccessTokenError extends Error {
  constructor(public readonly reason: 'expired' | 'invalid') {
    super(`access token ${reason}`);
  }
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    // Pin the algorithm: accepting whatever the token header claims is the
    // classic "alg: none" / algorithm-confusion forgery.
    const payload = jwt.verify(token, config.auth.accessSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'string') throw new AccessTokenError('invalid');
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0 || typeof payload.displayName !== 'string') {
      throw new AccessTokenError('invalid');
    }
    return { userId, displayName: payload.displayName };
  } catch (err) {
    if (err instanceof AccessTokenError) throw err;
    if (err instanceof jwt.TokenExpiredError) throw new AccessTokenError('expired');
    throw new AccessTokenError('invalid');
  }
}
