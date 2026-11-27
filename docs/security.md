# Security check

**Owner:** nickayvy · **Issue:** #19, task 8 · **Checked against:** `main` at the
Phase 2 feature freeze

A one-page check of the three things the report promises: passwords are stored
safely, no SQL is built from user input, and each route only lets the right
people in.

## 1. Passwords are hashed with argon2id

- `server/src/services/passwords.ts` hashes every password with
  **argon2id** (`type: argon2.argon2id`) at the OWASP minimum: 19 MiB memory,
  2 passes, 1 lane. The parameters are stored inside each hash, so raising them
  later needs no migration.
- There is **no plaintext password column**. `user.password_hash` holds only
  the encoded `$argon2id$v=19$m=19456,t=2,p=1$…` string.
  `auth.test.ts` (_"stores only an argon2id hash"_ and _"has no
  plaintext-password column anywhere in the schema"_) checks both.
- **Sign-in does not reveal which emails exist.** An unknown email still runs a
  real argon2id verify against a dummy hash, and a wrong password gets the same
  answer (`auth.test.ts`: _"gives an unknown email and a wrong password the
  identical response"_).
- **Passwords:** at least 10 characters, with a letter and a number. This is
  checked by the shared zod schema on the client and again on the server.
- **Sessions:** a 15-minute JWT access token, kept in memory and never in
  `localStorage`. There is also a refresh cookie, set `httpOnly` and
  `SameSite=Lax` and `Secure` (unless `COOKIE_SECURE=false`, for local HTTP). The database stores only its
  SHA-256. The token rotates on every use, and reusing an old one revokes the
  whole family (`auth.test.ts`).
- **Brute force:** after the 6th failed sign-in from one IP the server answers 429. Registration and password reset are limited too. On Render,
  `TRUST_PROXY` makes the limit count the real client IP.

## 2. No SQL built from user input

**Method:** a search of all server code for SQL template strings with `${…}`
in them:

```bash
grep -rn '\${' server/src/repositories server/src/services server/src/routes \
  | grep -i 'select\|insert\|update\|delete\|call\|from\|where\|set '
```

**Every hit, and why it is safe:**

| File                                      | What is interpolated                         | Why it is safe                                                                                                                 |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `group.repo.ts` `listGroups`, `getGroup`  | `CARD_COLUMNS`, a list of `WHERE` conditions | Both are fixed strings in the code. Filter **values** are bound as `:gameId`, `:regionId`, `:platformId`, `:limit`, `:offset`. |
| `group.repo.ts` `updateGroup`             | a list of `SET` assignments                  | Fixed strings chosen by which fields are present. Values are bound as `:title`, `:description`, `:maxMembers`.                 |
| `group.repo.ts` `callMembershipProcedure` | the procedure name                           | The TypeScript type allows only `'sp_join_group' \| 'sp_leave_group'`. The ids are bound.                                      |
| `profile.repo.ts` `patchProfile`          | column names                                 | Looked up in a fixed `columns` map. Unknown keys are dropped before the query, and values are bound as `:key`.                 |
| `profile.repo.ts` `patchUserGame`         | column names                                 | Same pattern: a fixed map, with bound values.                                                                                  |
| `profile.repo.ts` `existingIdCount`       | table and column name, a `?,?,?` list        | The table and column are typed literals. The ids are bound as `?` placeholders.                                                |

Things the search did **not** find: string concatenation of request data into
SQL, `multipleStatements: true` on the server pool, or `pool.escape` used as a
substitute for binding. Every user-supplied value reaches MySQL as a bound
parameter (`namedPlaceholders: true` in `server/src/db/pool.ts`).

The operator scripts in `db/` (ETL, perf experiments) interpolate only table,
index and database names that are constants in the same file. They are run by
hand and never take web input.

**A second line of defence:** route parameters are checked before any query.
`GET /api/groups/1 OR 1=1` answers `400 VALIDATION_ERROR`
(`key.test.ts`), and every request body passes a strict zod schema that rejects
unknown fields.

## 3. Who can do what

"Member" means an **active** member of that group. On the group routes guarded
by `requireGroupRole`, a non-member, a former member and a group that doesn't exist
all get the same 403, so those routes never reveal which groups exist
(`auth.test.ts`). The two `/api/sessions/:id/…` routes answer 404 for a session
that doesn't exist.

| Route                                               | Anyone (no login) | Signed in         | Group member                          | Group owner |
| --------------------------------------------------- | ----------------- | ----------------- | ------------------------------------- | ----------- |
| `GET /api/health`, `/api/lookups`, `/api/games/*`   | ✅                | ✅                | ✅                                    | ✅          |
| `POST /api/auth/register`, `/login`, password reset | ✅ (rate-limited) | ✅                | ✅                                    | ✅          |
| `GET /api/profile/:displayName`                     | ✅ ¹              | ✅ ¹              | ✅ ¹                                  | ✅ ¹        |
| `GET/PATCH/PUT /api/profile/me…` (own profile)      | ❌ 401            | ✅ own data only  | ✅                                    | ✅          |
| `GET /api/matches`, `/api/reports/summary`          | ❌ 401            | ✅                | ✅                                    | ✅          |
| `GET /api/groups`, `GET /api/groups/:id`            | ❌ 401            | ✅                | ✅                                    | ✅          |
| `POST /api/groups` (create)                         | ❌ 401            | ✅, becomes owner | ✅                                    | ✅          |
| `POST /api/groups/:id/join`, `/leave`               | ❌ 401            | ✅                | ✅                                    | ✅          |
| `GET/POST /api/groups/:id/messages`                 | ❌ 401            | ❌ 403            | ✅                                    | ✅          |
| `GET/POST /api/groups/:id/sessions`                 | ❌ 401            | ❌ 403            | ✅                                    | ✅          |
| `PATCH /api/groups/:id` (edit or close)             | ❌ 401            | ❌ 403            | ❌ 403                                | ✅          |
| `POST /api/sessions/:id/played`                     | ❌ 401            | ❌ 403            | ❌ 403                                | ✅          |
| `POST /api/sessions/:id/ratings`                    | ❌ 401            | ❌ 409 (trigger)  | ✅, once per teammate, after "played" | ✅          |

¹ Public profiles show a rough availability summary (for example
"weekday evenings"). Exact times are shown only to the person themselves and
to people who share an active group with them.

Ratings are guarded in the database. A trigger rejects a rating unless the
session was played and both people are active members of its group, and a
UNIQUE key allows only one rating per pair. So even a direct SQL insert can't
break the rule.

### Checking it with `curl`

Start the API (`npm run dev --workspace=server`) and seed the demo data
(`npm run db:seed`). Then:

```bash
API=http://localhost:4000/api
# Log in as two demo users. The access token is in the JSON reply.
MAYA=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"maya@demo.faze","password":"DemoPass123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
code() { curl -s -o /dev/null -w '%{http_code}\n' "$@"; }

code $API/profile/me                                   # 401 no token
code -H "Authorization: Bearer $MAYA" $API/profile/me  # 200
code -H "Authorization: Bearer $MAYA" $API/groups/1/messages   # 200 if Maya is in group 1, else 403
code -H "Authorization: Bearer $MAYA" -X PATCH $API/groups/2 \
  -H 'Content-Type: application/json' -d '{"title":"hijack"}'  # 403 unless Maya owns group 2
code -H "Authorization: Bearer $MAYA" "$API/groups/1%20OR%201=1"  # 400
code -H "Authorization: Bearer x.y.z" $API/profile/me  # 401 forged token
```

Each expected code is also asserted automatically on every push. The
401 and 400 cases are in `server/tests/key.test.ts`. The member, owner and 403
cases are in `auth.test.ts`, `groups.test.ts`, `group-edit.test.ts`,
`messages.test.ts` and `sessions.test.ts`. So the table above is kept true by
CI, not only by this one-off check.

## 4. Other protections, briefly

- `helmet()` sets the standard security headers. CORS allows only
  `CLIENT_ORIGIN`, and in production `/api` is served from the same site
  through the Vercel rewrite, so the cookie never crosses sites.
- Request bodies are capped at 100 kB. Malformed JSON gets the error envelope,
  never a stack trace.
- Secrets (`JWT_*`, `DB_PASSWORD`, `DB_SSL_CA`) live only in environment
  variables on Render and in local `.env` files. `.env` is gitignored, and
  `.env.example` holds placeholders only.
- **Known limit:** `requireAuth` checks only the JWT signature and expiry, with
  no database lookup. A suspended or deleted account's access token keeps
  working on most routes until it expires, which takes at most 15 minutes.
  `/api/auth/me` reads the account and refuses it at once (`auth.test.ts`).
  Suspending an account also ends its refresh tokens straight away, so no new
  access token is issued.
