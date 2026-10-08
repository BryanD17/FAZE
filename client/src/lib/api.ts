import { errorEnvelopeSchema, type SessionResponse } from '@faze/shared';

// Kept in memory only; the refresh cookie restores it after a page reload.
let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;
let onSignedOut: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setOnSignedOut(callback: (() => void) | null) {
  onSignedOut = callback;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly field: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Options = { method?: string; body?: unknown };

function send(path: string, options: Options) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });
}

async function read<T>(res: Response): Promise<T> {
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorEnvelopeSchema.safeParse(data);
    if (parsed.success) {
      const { code, message, field } = parsed.data.error;
      throw new ApiError(res.status, code, message, field);
    }
    throw new ApiError(res.status, 'UNKNOWN', `Request failed with status ${res.status}`);
  }
  return data as T;
}

/**
 * Single-flight: the refresh cookie rotates on every use, and replaying the old
 * one ends every session for the user, so parallel callers must share one request.
 */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshing ??= send('/auth/refresh', { method: 'POST' })
    .then((res) => read<SessionResponse>(res))
    .then((session) => {
      accessToken = session.accessToken;
      return session;
    })
    .catch(() => {
      accessToken = null;
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  let res = await send(path, options);
  if (res.status === 401 && accessToken && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      res = await send(path, options);
    } else {
      onSignedOut?.();
    }
  }
  return read<T>(res);
}
