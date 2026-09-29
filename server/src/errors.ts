/**
 * The typed error every layer throws for an expected failure.
 *
 * Convention B.2: never `res.status(500).json({ error: e.message })` — that
 * leaks internals. A layer throws an AppError with a stable machine-readable
 * `code` (SCREAMING_SNAKE), the HTTP status, a human message, and — when the
 * failure belongs to one input — the `field`, so the client can highlight it.
 * The terminal error middleware turns it into the shared error envelope.
 *
 * AGENT 09 freezes the full code list in @faze/shared; the codes used by auth
 * are defined here so that move is a rename, not a redesign.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly field: string | null = null,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_JSON: 'INVALID_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_DELETED: 'ACCOUNT_DELETED',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  INVALID_OR_EXPIRED_TOKEN: 'INVALID_OR_EXPIRED_TOKEN',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  DISPLAY_NAME_TAKEN: 'DISPLAY_NAME_TAKEN',
  FORBIDDEN_GROUP_ROLE: 'FORBIDDEN_GROUP_ROLE',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL',
} as const;
