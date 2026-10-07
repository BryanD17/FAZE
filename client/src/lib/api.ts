import { errorEnvelopeSchema } from '@faze/shared';

// Kept in memory only; the refresh cookie restores it after a page reload.
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
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

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });

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
