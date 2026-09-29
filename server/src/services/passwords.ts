/**
 * Password hashing (argon2id) and the timing-equalizing dummy verify.
 *
 * Parameters are the OWASP-recommended argon2id minimum (19 MiB, 2 passes,
 * 1 lane). They are encoded into every hash, so raising them later needs no
 * migration: old hashes keep verifying with their own parameters.
 */
import argon2 from 'argon2';
import crypto from 'node:crypto';

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/** Never throws: a malformed stored hash is simply "does not match". */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/**
 * A real argon2id hash of a random secret, computed once. Verifying against it
 * when the email is unknown costs the same as verifying a real account, so
 * response time does not reveal whether an account exists.
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(crypto.randomBytes(24).toString('base64url'));
  return dummy;
}
