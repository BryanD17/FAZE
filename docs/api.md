# API contract

> **Status:** AGENT 09 will freeze the full contract, generate OpenAPI, and add the
> standard error/pagination envelopes for every endpoint. Until then this file
> documents the endpoints that exist, so the people building against them
> (rita for the auth screens in AGENT 11, Alvin for profiles in AGENT 05) are not
> guessing. Request/response shapes are the zod schemas in
> `shared/src/schemas/auth.ts` — the client should import those, not retype them.

Base URL in development: `http://localhost:4000`. The Vite dev server proxies
`/api` to it, so the browser can call `/api/...` on its own origin.

## Conventions used so far

**Errors** always use one envelope, with a stable SCREAMING_SNAKE `code` and, when
the failure belongs to a single input, the `field` to highlight:

```json
{
  "error": {
    "code": "EMAIL_TAKEN",
    "message": "An account with this email already exists.",
    "field": "email",
    "details": null
  }
}
```

**Authentication** is a short-lived access token plus a rotating refresh cookie:

- `accessToken` (JWT, 15 minutes) is returned in the response body. Send it as
  `Authorization: Bearer <token>` and keep it **in memory**, not in `localStorage`.
- The refresh token lives only in an `httpOnly; Secure; SameSite=Lax` cookie named
  `faze_refresh`, scoped to `Path=/api/auth`. JavaScript cannot read it and it is
  never in a response body. Call `POST /api/auth/refresh` when a request returns
  401; use a single-flight lock so ten parallel 401s cause one refresh.
- `Secure` cookies work on `http://localhost` in Chrome, Edge and Firefox. Safari
  needs `COOKIE_SECURE=false` in `.env` for local development.

## Endpoints

| Method | Path                               | Auth               | Purpose                                          |
| ------ | ---------------------------------- | ------------------ | ------------------------------------------------ |
| GET    | `/api/health`                      | none               | `{ ok, db }` from a real `SELECT 1`              |
| POST   | `/api/auth/register`               | none, rate-limited | Create an account                                |
| POST   | `/api/auth/verify-email`           | none               | Spend an emailed verification token              |
| POST   | `/api/auth/login`                  | none, rate-limited | Email + password → session                       |
| POST   | `/api/auth/refresh`                | refresh cookie     | Rotate the refresh token, get a new access token |
| POST   | `/api/auth/logout`                 | refresh cookie     | Revoke the refresh token (idempotent)            |
| GET    | `/api/auth/me`                     | Bearer             | The caller's own profile                         |
| POST   | `/api/auth/request-password-reset` | none, rate-limited | Email a reset link (always 202)                  |
| POST   | `/api/auth/reset-password`         | none, rate-limited | Spend a reset token, set a new password          |

### `POST /api/auth/register`

Body: `{ "email", "password", "displayName" }` — email is lowercased and trimmed;
password 10–128 chars with at least one letter and one digit; displayName 3–40
chars of `A-Za-z0-9_.- `. Unknown properties are rejected.

`201` → `{ "user": { userId, email, displayName, status }, "verificationRequired": true }`.
The account is `pending` until the emailed link is used.

| Status | `code`               | `field`             |
| ------ | -------------------- | ------------------- |
| 400    | `VALIDATION_ERROR`   | the offending input |
| 409    | `EMAIL_TAKEN`        | `email`             |
| 409    | `DISPLAY_NAME_TAKEN` | `displayName`       |
| 429    | `RATE_LIMITED`       | —                   |

### `POST /api/auth/verify-email`

Body: `{ "token" }`. `200` → `{ "ok": true }`. `400 INVALID_OR_EXPIRED_TOKEN` if the
token is unknown, already used, or older than 24 hours.

### `POST /api/auth/login`

Body: `{ "email", "password" }`. `200` →
`{ accessToken, tokenType: "Bearer", expiresIn: 900, user }` plus the refresh cookie.

| Status | `code`                | Meaning                                                                                         |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------- |
| 401    | `INVALID_CREDENTIALS` | Wrong password **or** unknown email — deliberately indistinguishable                            |
| 403    | `EMAIL_NOT_VERIFIED`  | Correct password, address not yet verified                                                      |
| 403    | `ACCOUNT_SUSPENDED`   | Correct password, account suspended                                                             |
| 403    | `ACCOUNT_DELETED`     | Correct password, account deleted                                                               |
| 429    | `RATE_LIMITED`        | 5 **failed** attempts / 15 min / IP; body has `details.retryAfterSeconds`, header `Retry-After` |

### `POST /api/auth/refresh`

No body; reads the cookie. `200` → same shape as login, and a **new** cookie
(the old token is now revoked). Failures clear the cookie:

| Status | `code`                                  | Meaning                                                                 |
| ------ | --------------------------------------- | ----------------------------------------------------------------------- |
| 401    | `INVALID_REFRESH_TOKEN`                 | Missing, unknown, or expired                                            |
| 401    | `REFRESH_TOKEN_REUSED`                  | A revoked token was replayed — **every** session for the user was ended |
| 403    | `ACCOUNT_SUSPENDED` / `ACCOUNT_DELETED` | The account is no longer allowed in                                     |

### `POST /api/auth/logout`

No body. Always `204` and clears the cookie, whether or not a session existed.

### `GET /api/auth/me`

`200` → `{ userId, email, status, displayName, bio, avatarUrl, birthYear, timezone,
micAvailable, regionCode, languageCode, platforms: string[], tags: string[],
primaryGameId }`. `401 UNAUTHENTICATED` (with `WWW-Authenticate: Bearer`) if the
token is missing, malformed, or expired; an expired token has
`details: { "reason": "expired" }`.

### `POST /api/auth/request-password-reset` and `POST /api/auth/reset-password`

Request: `{ "email" }` → always `202 { "ok": true }`, identical whether or not the
address has an account. Reset: `{ "token", "newPassword" }` → `200 { "ok": true }`,
or `400 INVALID_OR_EXPIRED_TOKEN` (single use, 1 hour) / `400 VALIDATION_ERROR`
with `field: "newPassword"`. A successful reset ends every existing session.

## Example session

```bash
curl -i -X POST localhost:4000/api/auth/register -H 'content-type: application/json' \
  -d '{"email":"demo@example.com","password":"correct horse 9","displayName":"Demo User"}'
# 201  {"user":{"userId":1,"email":"demo@example.com","displayName":"Demo User","status":"pending"},"verificationRequired":true}

# In development the server prints the verification link (there is no mail provider yet).
curl -X POST localhost:4000/api/auth/verify-email -H 'content-type: application/json' -d '{"token":"<from the link>"}'
# 200  {"ok":true}

curl -i -c jar.txt -X POST localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"demo@example.com","password":"correct horse 9"}'
# 200  Set-Cookie: faze_refresh=…; Max-Age=2592000; Path=/api/auth; HttpOnly; Secure; SameSite=Lax
#      {"accessToken":"…","tokenType":"Bearer","expiresIn":900,"user":{…,"status":"active"}}

curl localhost:4000/api/auth/me -H "authorization: Bearer $ACCESS"
```

## Helpers other agents should use

- `requireAuth` (`server/src/middleware/requireAuth.ts`) — attaches `req.user`.
- `requireGroupRole('member' | 'moderator' | 'owner', param = 'id')` — attaches
  `req.groupRole`. A non-member, a former member and a nonexistent group all get
  the same 403 `FORBIDDEN_GROUP_ROLE`, so it cannot be used to probe which groups exist.
- `validateBody(schema)` and `asyncHandler` — validate against a shared zod schema,
  and forward a rejected promise to the error middleware.
- Throw `AppError(code, status, message, field?)` for an expected failure; never
  `res.status(500).json({ error: e.message })`.

### `GET /api/profile/:displayName`

Public profiles never return the account email or exact birth year. Birth year
is reduced to an age bracket.

Exact availability is returned only to the profile owner or to users who share
an active group with that profile. Other viewers receive only a coarse summary
such as `evenings` or `weekends`.