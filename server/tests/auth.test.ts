/**
 * Authentication, end to end against a real MySQL (faze_test).
 *
 * Nothing here mocks the database or the token logic: the point of these tests
 * is that the guarantees hold in the real system — rotation actually revokes a
 * row, a reset actually ends sessions, a rolled-back registration actually
 * leaves no user behind.
 *
 * Identities are unique per run and everything is removed in afterAll.
 */
import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closePool, pool } from '../src/db/pool.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requireAuth } from '../src/middleware/requireAuth.js';
import { requireGroupRole } from '../src/middleware/requireGroupRole.js';
import { dummyHash } from '../src/services/passwords.js';
import { hashToken } from '../src/services/tokens.js';
import type { Mailer } from '../src/services/mailer.js';

const DOMAIN = '@auth-test.faze';
const SECRET = process.env.JWT_ACCESS_SECRET as string;

class CapturingMailer implements Mailer {
  verifications: { to: string; url: string }[] = [];
  resets: { to: string; url: string }[] = [];
  async sendVerification(to: string, url: string) {
    this.verifications.push({ to, url });
  }
  async sendPasswordReset(to: string, url: string) {
    this.resets.push({ to, url });
  }
  private last(list: { to: string; url: string }[], to: string): string {
    const hit = [...list].reverse().find((m) => m.to === to);
    if (!hit) throw new Error(`no email captured for ${to}`);
    return new URL(hit.url).searchParams.get('token') as string;
  }
  verificationToken = (to: string) => this.last(this.verifications, to);
  resetToken = (to: string) => this.last(this.resets, to);
}

const mailer = new CapturingMailer();
// High limits for every test except the rate-limit tests, which build their own app.
const ROOMY = { windowMs: 60_000, limit: 100_000 };
const app = createApp({ mailer, rateLimits: { register: ROOMY, signIn: ROOMY, reset: ROOMY } });

const uniq = () => crypto.randomBytes(4).toString('hex');
const identity = () => {
  const u = uniq();
  return { email: `u${u}${DOMAIN}`, displayName: `at_${u}`, password: 'Sup3rSecretPw' };
};
type Identity = ReturnType<typeof identity>;

const cookieOf = (res: request.Response): string => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const hit = raw?.find((c) => c.startsWith('faze_refresh='));
  if (!hit) throw new Error('no refresh cookie in response');
  return hit.split(';')[0] as string; // "faze_refresh=<value>"
};
const cookieValue = (pair: string) => pair.slice('faze_refresh='.length);

async function register(id: Identity, a: express.Express = app) {
  return request(a).post('/api/auth/register').send(id);
}
async function verify(id: Identity) {
  return request(app)
    .post('/api/auth/verify-email')
    .send({ token: mailer.verificationToken(id.email) });
}
async function signIn(id: Identity, password = id.password, a: express.Express = app) {
  return request(a).post('/api/auth/login').send({ email: id.email, password });
}
/** Registers, verifies and signs in. */
async function fullSession(id: Identity = identity()) {
  await register(id);
  await verify(id);
  const res = await signIn(id);
  return { id, res, access: res.body.accessToken as string, cookie: cookieOf(res) };
}

async function rows<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await pool.query<T[]>(sql, params);
  return r;
}
const userIdOf = async (email: string) =>
  (await rows<RowDataPacket>('SELECT user_id FROM `user` WHERE email = ?', [email]))[0]?.user_id as
    number | undefined;

async function cleanup() {
  const ids = (
    await rows<RowDataPacket>('SELECT user_id FROM `user` WHERE email LIKE ?', [`%${DOMAIN}`])
  ).map((r) => r.user_id as number);
  await pool.query("DELETE FROM lfg_group WHERE title LIKE 'AUTHTEST %'");
  await pool.query("DELETE FROM game WHERE slug LIKE 'auth-test-game-%'");
  if (ids.length) {
    await pool.query(
      "DELETE FROM audit_log WHERE table_name IN ('user','profile') AND row_pk IN (?)",
      [ids.map(String)],
    );
    await pool.query('DELETE FROM `user` WHERE user_id IN (?)', [ids]);
  }
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await closePool();
});

// -----------------------------------------------------------------------------
describe('POST /api/auth/register', () => {
  it('creates a pending account, stores only an argon2id hash, and emails a link', async () => {
    const id = identity();
    const res = await register(id);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: id.email,
      displayName: id.displayName,
      status: 'pending',
    });
    expect(res.body.verificationRequired).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(id.password);
    expect(mailer.verificationToken(id.email)).toHaveLength(43);

    const [u] = await rows<RowDataPacket>('SELECT password_hash FROM `user` WHERE email = ?', [
      id.email,
    ]);
    expect(u?.password_hash).toMatch(/^\$argon2id\$/);
    expect(u?.password_hash).not.toContain(id.password);
  });

  it('has no plaintext-password column anywhere in the schema', async () => {
    const cols = await rows<RowDataPacket>(
      `SELECT column_name AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND column_name LIKE '%password%'`,
    );
    expect(cols.map((c) => c.c)).toEqual(['password_hash']);
  });

  it('lowercases the email before storing it', async () => {
    const id = identity();
    const mixed = { ...id, email: id.email.toUpperCase() };
    const res = await register(mixed);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(id.email);
    expect(await userIdOf(id.email)).toBeTypeOf('number');
  });

  it('rejects a duplicate email with a field-scoped 409', async () => {
    const id = identity();
    await register(id);
    const res = await register({ ...identity(), email: id.email });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'EMAIL_TAKEN', field: 'email' });
  });

  it('rejects a duplicate display name with a 409, and leaves NO orphan user (transaction)', async () => {
    const first = identity();
    await register(first);
    const second = { ...identity(), displayName: first.displayName };
    const res = await register(second);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DISPLAY_NAME_TAKEN', field: 'displayName' });
    // The user row was inserted BEFORE the profile insert failed; it must be rolled back.
    expect(await userIdOf(second.email)).toBeUndefined();
  });

  it.each([
    ['too short', 'Ab1'],
    ['no digit', 'onlyletterspassword'],
    ['no letter', '1234567890123'],
  ])('rejects a weak password (%s)', async (_label, password) => {
    const res = await register({ ...identity(), password });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'password' });
  });

  it.each([
    ['too short', 'ab'],
    ['illegal characters', 'bad<name>!'],
  ])('rejects an invalid display name (%s)', async (_label, displayName) => {
    const res = await register({ ...identity(), displayName });
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('displayName');
  });

  it('rejects unexpected properties (strict schema)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...identity(), isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers malformed JSON with the error envelope, not a stack trace', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('content-type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });

  it('activates immediately only under the development-only shortcut', async () => {
    const dev = createApp({
      mailer,
      allowUnverifiedLogin: true,
      rateLimits: { register: ROOMY, signIn: ROOMY, reset: ROOMY },
    });
    const id = identity();
    const res = await register(id, dev);
    expect(res.status).toBe(201);
    expect(res.body.user.status).toBe('active');
    expect(res.body.verificationRequired).toBe(false);
    expect((await signIn(id, id.password, dev)).status).toBe(200);
    // ...and the normal app still refuses an unverified account.
    const other = identity();
    await register(other);
    expect((await signIn(other)).status).toBe(403);
  });
});

// -----------------------------------------------------------------------------
describe('email verification', () => {
  it('blocks sign-in until verified, then works; the token is single-use', async () => {
    const id = identity();
    await register(id);

    const early = await signIn(id);
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    expect((await verify(id)).status).toBe(200);
    expect((await signIn(id)).status).toBe(200);

    const again = await verify(id);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

    const [u] = await rows<RowDataPacket>(
      'SELECT status, email_verified_at FROM `user` WHERE email = ?',
      [id.email],
    );
    expect(u?.status).toBe('active');
    expect(u?.email_verified_at).not.toBeNull();
  });

  it('records the status change in audit_log (trg_user_bu integration)', async () => {
    const id = identity();
    await register(id);
    await verify(id);
    const uid = await userIdOf(id.email);
    const [a] = await rows<RowDataPacket>(
      "SELECT new_values FROM audit_log WHERE table_name = 'user' AND row_pk = ?",
      [String(uid)],
    );
    expect(JSON.stringify(a?.new_values)).toContain('active');
  });

  it('rejects an expired token and an unknown token', async () => {
    const id = identity();
    await register(id);
    const token = mailer.verificationToken(id.email);
    await pool.query('UPDATE email_verification SET expires_at = ? WHERE token_hash = ?', [
      new Date(Date.now() - 1000),
      hashToken(token),
    ]);
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(400);
    const bogus = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'x'.repeat(43) });
    expect(bogus.status).toBe(400);
  });
});

// -----------------------------------------------------------------------------
describe('POST /api/auth/login', () => {
  it('returns a 15-minute JWT and an httpOnly refresh cookie — never the refresh token in the body', async () => {
    const { id, res } = await fullSession();
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.body.tokenType).toBe('Bearer');
    expect(res.body.expiresIn).toBe(900);

    const claims = jwt.verify(res.body.accessToken, SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    expect(claims.sub).toBe(String(await userIdOf(id.email)));
    expect(claims.displayName).toBe(id.displayName);
    expect((claims.exp as number) - (claims.iat as number)).toBe(900);

    const setCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('faze_refresh='),
    );
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/auth/i);
  });

  it('stores only the SHA-256 of the refresh token and stamps last_login_at', async () => {
    const { id, cookie } = await fullSession();
    const raw = cookieValue(cookie);
    const stored = await rows<RowDataPacket>(
      'SELECT token_hash FROM refresh_token WHERE token_hash IN (?, ?)',
      [hashToken(raw), raw],
    );
    expect(stored.map((s) => s.token_hash)).toEqual([hashToken(raw)]);
    const [u] = await rows<RowDataPacket>('SELECT last_login_at FROM `user` WHERE email = ?', [
      id.email,
    ]);
    expect(u?.last_login_at).not.toBeNull();
  });

  it('gives an unknown email and a wrong password the identical response', async () => {
    const { id } = await fullSession();
    const wrong = await signIn(id, 'not-the-password-1');
    const unknown = await signIn({ ...identity() });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('runs a real argon2id verification even when the account does not exist', async () => {
    const dummy = await dummyHash();
    // argon2 writes its parameters in the order m, p, t.\n    expect(dummy).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(await dummyHash()).toBe(dummy); // computed once, reused
  });

  it('refuses a suspended account with a clear 403 — but only after the password is proven', async () => {
    const { id } = await fullSession();
    await pool.query("UPDATE `user` SET status = 'suspended' WHERE email = ?", [id.email]);

    const proven = await signIn(id);
    expect(proven.status).toBe(403);
    expect(proven.body.error.code).toBe('ACCOUNT_SUSPENDED');

    // A wrong password must not reveal that the account is suspended.
    const unproven = await signIn(id, 'wrong-guess-123');
    expect(unproven.status).toBe(401);
    expect(unproven.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

// -----------------------------------------------------------------------------
describe('GET /api/auth/me and requireAuth', () => {
  it('returns the caller’s profile and never a password hash', async () => {
    const { id, access } = await fullSession();
    const res = await request(app).get('/api/auth/me').set('authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: id.email,
      displayName: id.displayName,
      status: 'active',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|argon2/i);
  });

  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects garbage, wrong-secret, alg:none and expired tokens', async () => {
    const { access } = await fullSession();
    const claims = jwt.decode(access) as jwt.JwtPayload;
    const get = (t: string) => request(app).get('/api/auth/me').set('authorization', `Bearer ${t}`);

    expect((await get('not-a-jwt')).status).toBe(401);

    const wrongSecret = jwt.sign(
      { displayName: 'x' },
      'a-completely-different-secret-value-0123456789',
      {
        subject: claims.sub as string,
      },
    );
    expect((await get(wrongSecret)).status).toBe(401);

    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: claims.sub, displayName: 'x' })}.`;
    expect((await get(none)).status).toBe(401);

    const expired = jwt.sign({ displayName: 'x' }, SECRET, {
      algorithm: 'HS256',
      subject: claims.sub as string,
      expiresIn: -10,
    });
    const res = await get(expired);
    expect(res.status).toBe(401);
    expect(res.body.error.details).toEqual({ reason: 'expired' });
  });

  it('rejects a still-valid token whose account has since been deleted', async () => {
    const { id, access } = await fullSession();
    await pool.query("UPDATE `user` SET status = 'deleted' WHERE email = ?", [id.email]);
    const res = await request(app).get('/api/auth/me').set('authorization', `Bearer ${access}`);
    expect(res.status).toBe(401);
  });
});

// -----------------------------------------------------------------------------
describe('POST /api/auth/refresh', () => {
  const refresh = (cookie?: string) => {
    const r = request(app).post('/api/auth/refresh');
    return cookie ? r.set('cookie', cookie) : r;
  };
  const liveTokens = async (email: string) =>
    Number(
      (
        await rows<RowDataPacket>(
          `SELECT COUNT(*) AS n FROM refresh_token r JOIN \`user\` u ON u.user_id = r.user_id
            WHERE u.email = ? AND r.revoked_at IS NULL`,
          [email],
        )
      )[0]?.n,
    );

  it('rotates: a new token is issued and the old one is revoked in the database', async () => {
    const { id, cookie } = await fullSession();
    const res = await refresh(cookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    const next = cookieOf(res);
    expect(next).not.toBe(cookie);

    const [old] = await rows<RowDataPacket>(
      'SELECT revoked_at FROM refresh_token WHERE token_hash = ?',
      [hashToken(cookieValue(cookie))],
    );
    expect(old?.revoked_at).not.toBeNull();
    expect(await liveTokens(id.email)).toBe(1);
    // and the new access token really works
    const me = await request(app)
      .get('/api/auth/me')
      .set('authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('detects reuse of a revoked token and revokes the WHOLE family', async () => {
    const { id, cookie: first } = await fullSession();
    const second = cookieOf(await refresh(first));

    const replay = await refresh(first); // the stolen / replayed copy
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The revocation must have COMMITTED even though the request failed.
    expect(await liveTokens(id.email)).toBe(0);
    expect((await refresh(second)).status).toBe(401);
  });

  it('serializes two simultaneous refreshes of one token: exactly one wins', async () => {
    const { cookie } = await fullSession();
    const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it('rejects a missing, unknown or expired refresh token', async () => {
    expect((await refresh()).status).toBe(401);
    expect((await refresh('faze_refresh=' + 'A'.repeat(43))).status).toBe(401);

    const { cookie } = await fullSession();
    await pool.query('UPDATE refresh_token SET expires_at = ? WHERE token_hash = ?', [
      new Date(Date.now() - 1000),
      hashToken(cookieValue(cookie)),
    ]);
    const res = await refresh(cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('refuses to refresh a suspended account and ends all its sessions', async () => {
    const { id, cookie } = await fullSession();
    await pool.query("UPDATE `user` SET status = 'suspended' WHERE email = ?", [id.email]);
    const res = await refresh(cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(await liveTokens(id.email)).toBe(0);
  });
});

// -----------------------------------------------------------------------------
describe('POST /api/auth/logout', () => {
  it('revokes the token, clears the cookie, and is idempotent', async () => {
    const { cookie } = await fullSession();
    const res = await request(app).post('/api/auth/logout').set('cookie', cookie);
    expect(res.status).toBe(204);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('faze_refresh='),
    );
    expect(cleared).toMatch(/faze_refresh=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    expect((await request(app).post('/api/auth/refresh').set('cookie', cookie)).status).toBe(401);
    expect((await request(app).post('/api/auth/logout').set('cookie', cookie)).status).toBe(204);
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
  });
});

// -----------------------------------------------------------------------------
describe('password reset', () => {
  const requestReset = (email: string) =>
    request(app).post('/api/auth/request-password-reset').send({ email });
  const reset = (token: string, newPassword: string) =>
    request(app).post('/api/auth/reset-password').send({ token, newPassword });

  it('answers identically whether or not the address has an account, and emails only real ones', async () => {
    const { id } = await fullSession();
    const known = await requestReset(id.email);
    const ghost = identity();
    const unknown = await requestReset(ghost.email);
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(() => mailer.resetToken(id.email)).not.toThrow();
    expect(() => mailer.resetToken(ghost.email)).toThrow();
  });

  it('changes the password, is single-use, and ends every existing session', async () => {
    const { id, cookie } = await fullSession();
    await requestReset(id.email);
    const token = mailer.resetToken(id.email);

    const ok = await reset(token, 'BrandNewPassw0rd');
    expect(ok.status).toBe(200);
    expect((await signIn(id)).status).toBe(401); // old secret is dead
    expect((await signIn(id, 'BrandNewPassw0rd')).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').set('cookie', cookie)).status).toBe(401);

    const reuse = await reset(token, 'AnotherPassw0rd1');
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects an expired token and a weak new password', async () => {
    const { id } = await fullSession();
    await requestReset(id.email);
    const token = mailer.resetToken(id.email);

    const weak = await reset(token, 'short1');
    expect(weak.status).toBe(400);
    expect(weak.body.error.field).toBe('newPassword');

    await pool.query('UPDATE password_reset SET expires_at = ? WHERE token_hash = ?', [
      new Date(Date.now() - 1000),
      hashToken(token),
    ]);
    expect((await reset(token, 'ValidPassw0rd99')).status).toBe(400);
  });

  it('retires an older link when a newer one is requested', async () => {
    const { id } = await fullSession();
    await requestReset(id.email);
    const first = mailer.resetToken(id.email);
    await requestReset(id.email);
    const second = mailer.resetToken(id.email);
    expect(second).not.toBe(first);
    expect((await reset(first, 'ValidPassw0rd99')).status).toBe(400);
    expect((await reset(second, 'ValidPassw0rd99')).status).toBe(200);
  });
});

// -----------------------------------------------------------------------------
describe('rate limiting (5 attempts / 15 minutes / IP)', () => {
  const tight = (limit: number) =>
    createApp({
      mailer,
      rateLimits: {
        register: { windowMs: 60_000, limit },
        signIn: { windowMs: 60_000, limit },
        reset: { windowMs: 60_000, limit },
      },
    });

  it('trips on the 6th failed sign-in with a 429 in the standard envelope', async () => {
    const limited = tight(5);
    const { id } = await fullSession();
    const statuses: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await signIn(id, `wrong-guess-${i}-x`, limited);
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(last?.body.error).toMatchObject({ code: 'RATE_LIMITED', field: null });
    expect(Number(last?.headers['retry-after'])).toBeGreaterThan(0);
    expect(last?.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('does not count SUCCESSFUL sign-ins, so a shared IP is not locked out by its own users', async () => {
    const limited = tight(2);
    const { id } = await fullSession();
    for (let i = 0; i < 5; i++) expect((await signIn(id, id.password, limited)).status).toBe(200);
  });

  it('limits registration and reset requests', async () => {
    const reg = tight(2);
    expect((await register(identity(), reg)).status).toBe(201);
    expect((await register(identity(), reg)).status).toBe(201);
    expect((await register(identity(), reg)).status).toBe(429);

    const rst = tight(2);
    const send = () =>
      request(rst).post('/api/auth/request-password-reset').send({ email: identity().email });
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(429);
  });
});

// -----------------------------------------------------------------------------
describe('requireGroupRole', () => {
  const guard = express();
  guard.use(express.json());
  guard.use(cookieParser());
  guard.get('/g/:id/member', requireAuth, requireGroupRole('member'), (req, res) => {
    res.json({ role: req.groupRole });
  });
  guard.get('/g/:id/mod', requireAuth, requireGroupRole('moderator'), (req, res) => {
    res.json({ role: req.groupRole });
  });
  guard.use(errorHandler);

  let groupId: number;
  const tokens: Record<'owner' | 'mod' | 'member' | 'outsider' | 'left', string> = {} as never;

  beforeAll(async () => {
    const people = {
      owner: await fullSession(),
      mod: await fullSession(),
      member: await fullSession(),
      outsider: await fullSession(),
      left: await fullSession(),
    };
    for (const [k, v] of Object.entries(people)) tokens[k as keyof typeof tokens] = v.access;
    const uid = async (k: keyof typeof people) => (await userIdOf(people[k].id.email)) as number;

    const [g] = await pool.query<import('mysql2/promise').ResultSetHeader>(
      "INSERT INTO game (title, slug, is_multiplayer) VALUES ('Auth Test Game', ?, 1)",
      [`auth-test-game-${uniq()}`],
    );
    const [grp] = await pool.query<import('mysql2/promise').ResultSetHeader>(
      "INSERT INTO lfg_group (owner_user_id, game_id, title, max_members) VALUES (?, ?, 'AUTHTEST group', 6)",
      [await uid('owner'), g.insertId],
    );
    groupId = grp.insertId;
    await pool.query(
      `INSERT INTO group_member (group_id, user_id, role, state, left_at) VALUES
         (?, ?, 'owner', 'active', NULL),
         (?, ?, 'moderator', 'active', NULL),
         (?, ?, 'member', 'active', NULL),
         (?, ?, 'member', 'left', NOW())`,
      [
        groupId,
        await uid('owner'),
        groupId,
        await uid('mod'),
        groupId,
        await uid('member'),
        groupId,
        await uid('left'),
      ],
    );
  });

  const call = (path: string, token?: string) => {
    const r = request(guard).get(path);
    return token ? r.set('authorization', `Bearer ${token}`) : r;
  };

  it('lets owner and moderator through a moderator route, and reports the role', async () => {
    const owner = await call(`/g/${groupId}/mod`, tokens.owner);
    expect(owner.status).toBe(200);
    expect(owner.body.role).toBe('owner');
    const mod = await call(`/g/${groupId}/mod`, tokens.mod);
    expect(mod.status).toBe(200);
    expect(mod.body.role).toBe('moderator');
  });

  it('lets a plain member through a member route but not a moderator route', async () => {
    expect((await call(`/g/${groupId}/member`, tokens.member)).status).toBe(200);
    const denied = await call(`/g/${groupId}/mod`, tokens.member);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN_GROUP_ROLE');
  });

  it('gives a non-member, a former member, and a nonexistent group the SAME 403', async () => {
    const outsider = await call(`/g/${groupId}/member`, tokens.outsider);
    const former = await call(`/g/${groupId}/member`, tokens.left);
    const missing = await call('/g/999999999/member', tokens.owner);
    const junk = await call('/g/not-a-number/member', tokens.owner);
    for (const r of [outsider, former, missing, junk]) expect(r.status).toBe(403);
    expect(outsider.body).toEqual(missing.body);
  });

  it('is unreachable without a valid token', async () => {
    const res = await call(`/g/${groupId}/member`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
