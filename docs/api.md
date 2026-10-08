# API contract

> **Status:** this file documents the endpoints that exist so the people building
> against them (nickayvy for the screens, everyone for tests) are not guessing. We are
> **not** generating OpenAPI or freezing an enterprise contract — see
> `docs/SCOPE.md`. Request shapes are the zod schemas in `shared/src/schemas/` —
> import those, do not retype them.

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
| GET    | `/api/lookups`                     | none               | Reference lists for profile and group forms      |
| POST   | `/api/auth/register`               | none, rate-limited | Create an account                                |
| POST   | `/api/auth/verify-email`           | none               | Spend an emailed verification token              |
| POST   | `/api/auth/login`                  | none, rate-limited | Email + password → session                       |
| POST   | `/api/auth/refresh`                | refresh cookie     | Rotate the refresh token, get a new access token |
| POST   | `/api/auth/logout`                 | refresh cookie     | Revoke the refresh token (idempotent)            |
| GET    | `/api/auth/me`                     | Bearer             | The caller's own profile                         |
| POST   | `/api/auth/request-password-reset` | none, rate-limited | Email a reset link (always 202)                  |
| POST   | `/api/auth/reset-password`         | none, rate-limited | Spend a reset token, set a new password          |

### `GET /api/lookups`

Public endpoint used by profile and group forms. `200` returns:

```json
{
  "regions": [{ "id": 1, "name": "North America East", "code": "NA-East" }],
  "languages": [{ "id": 1, "name": "English", "code": "en" }],
  "platforms": [{ "id": 1, "name": "PC", "slug": "pc" }],
  "tags": [{ "id": 2, "name": "Competitive", "slug": "competitive" }]
}
```

`GET /api/profile/me` lists platforms and tags by `slug`; use it to match them to these ids.

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

## Profile and games

All `/api/profile/me…` routes need `Authorization: Bearer <token>`. Request
shapes are the zod schemas in `shared/src/schemas/profile.ts` — import them, do
not retype them. Unknown fields are rejected with `400 VALIDATION_ERROR`.

| Method | Path                            | Body (shape)                                                                                                        | Purpose                                     |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| GET    | `/api/profile/me`               | —                                                                                                                   | Your full profile                           |
| PATCH  | `/api/profile/me`               | `profilePatchSchema`: any of `displayName, bio, avatarUrl, birthYear, regionId, languageId, timezone, micAvailable` | Edit basic fields                           |
| PUT    | `/api/profile/me/platforms`     | `{ platformIds: number[] }` (max 20)                                                                                | Replace your platforms                      |
| PUT    | `/api/profile/me/tags`          | `{ tagIds: number[] }` (max 5)                                                                                      | Replace your play-style tags                |
| GET    | `/api/profile/me/games`         | —                                                                                                                   | Your game list                              |
| POST   | `/api/profile/me/games`         | `{ gameId, selfRank?, rankTier?, hoursPlayed?, goal?, isPrimary? }`                                                 | Add a game                                  |
| PATCH  | `/api/profile/me/games/:gameId` | any of the optional fields above                                                                                    | Edit a game entry                           |
| DELETE | `/api/profile/me/games/:gameId` | —                                                                                                                   | Remove a game                               |
| PUT    | `/api/profile/me/availability`  | array of `{ dayOfWeek 0–6, startLocal "HH:MM", endLocal "HH:MM" }` (max 50) in the profile's `timezone`             | Replace weekly availability (stored in UTC) |
| GET    | `/api/profile/me/availability`  | —                                                                                                                   | Your availability                           |
| GET    | `/api/profile/me/completeness`  | —                                                                                                                   | **Frozen** — do not use                     |
| GET    | `/api/profile/:displayName`     | —                                                                                                                   | Someone's public profile                    |
| GET    | `/api/games/search?q=…`         | query: `q` (required), `platform`, `multiplayerOnly`, `limit`                                                       | Search the game catalog                     |
| GET    | `/api/games/popular`            | —                                                                                                                   | Most-owned games                            |

`goal` is one of `casual, ranked, learning, completionist, content`.

## Still to come (see `docs/SCOPE.md`)

`GET` and `POST /api/groups/:id/messages` (Alvin).
Each owner adds their own rows to this file when their PR lands.

## Groups

All five routes need `Authorization: Bearer <token>`. Request shapes are
`createGroupSchema` and `groupListQuerySchema` in `shared/src/schemas/group.ts`.
Groups are always created open to join; there is no approval step. Archived
groups (everyone left) behave as if they do not exist.

| Method | Path                    | Body / query                                                                                                | Purpose                                  |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| GET    | `/api/groups`           | query: `gameId`, `platformId`, `regionId` (all optional), `page` (default 1)                                | 20 groups per page, newest first         |
| POST   | `/api/groups`           | `{ gameId, title 3–120, description? ≤1000, regionId, languageId, maxMembers 2–10, platformIds: 1–10 ids }` | Create a group; you become its owner     |
| GET    | `/api/groups/:id`       | —                                                                                                           | One group with its members               |
| POST   | `/api/groups/:id/join`  | —                                                                                                           | Join (`sp_join_group`, safe under races) |
| POST   | `/api/groups/:id/leave` | —                                                                                                           | Leave (`sp_leave_group`)                 |

**List** `200` → `{ groups: Card[], page, hasMore }`, where a card is
`{ groupId, title, gameId, gameTitle, gameCoverUrl, regionCode, ownerDisplayName,
memberCount, maxMembers, openSlots, platforms: string[], status, createdAt }`
(the same fields `GET /api/matches` uses, without the score).

**Detail** `200` (and **create** `201`) → a card plus `{ description, languageCode,
regionName, myRole: 'owner' | 'moderator' | 'member' | null, members: [{ displayName,
role, joinedAt }] }`. `myRole` is `null` when you are not a member.

**Join** `200` → `{ "result": "JOINED" }`. **Leave** `200` →
`{ "result": "LEFT_MEMBER_REMAINS" | "LEFT_SUCCESSOR_PROMOTED" | "LEFT_GROUP_ARCHIVED" }`.

| Status | `code`              | When                                                                              |
| ------ | ------------------- | --------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`  | Bad body or query, or `:id` is not a positive integer (`field: "id"`)             |
| 404    | `GROUP_NOT_FOUND`   | No such group, the group is archived, or you leave a group you are not in         |
| 409    | `GROUP_FULL`        | Join: no free seat                                                                |
| 409    | `ALREADY_MEMBER`    | Join: you are already in the group                                                |
| 409    | the procedure code  | Join: any other refusal from `sp_join_group`                                      |
| 422    | `INVALID_REFERENCE` | Create: an id does not exist, or the game is not multiplayer (`field` says which) |

## Matches

| Method | Path           | Auth   | Purpose                                                                                    |
| ------ | -------------- | ------ | ------------------------------------------------------------------------------------------ |
| GET    | `/api/matches` | Bearer | Up to 20 open groups ranked for you, each with a `score` (0–100) and the reasons behind it |

How the score is worked out, with an example and the exact reply, is in
[`matchmaking.md`](matchmaking.md).

## Reports

| Method | Path                   | Auth   | Purpose                                                 |
| ------ | ---------------------- | ------ | ------------------------------------------------------- |
| GET    | `/api/reports/summary` | Bearer | Read-only database snapshot for a "database stats" page |

Reply: `{ totals: { users, games, groups, activeMembers, messages }, memberCountDrift, popularGames: [{ gameId, title, activeGroups, searchingUsers }] }`.
`memberCountDrift` is the number of groups whose stored `member_count` differs from
the real count (it must be `0`). `popularGames` is the top 10 from the
`v_game_popularity` view. The view takes about 0.3 s on the full catalog, so call
this once per page load, not in a loop.
