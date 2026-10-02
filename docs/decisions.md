# Decision log (ADRs)

One dated paragraph per real decision: what we chose, what we rejected, and
why. If a decision is reversed later, add a new entry rather than editing the
old one — the history is the useful part.

---

## 2026-09-17 — MySQL 8, not PostgreSQL

**Decision:** MySQL 8 with InnoDB and `utf8mb4_0900_ai_ci` throughout.

CS 514 teaches against MySQL: zyBooks sections 1.5–1.9 use MySQL Workbench and
the Sakila sample database, and the labs assume that environment. Choosing
PostgreSQL would mean every teammate maintains a mental translation layer
between the course material and the project, and the instructor could not open
our schema in the tool the course standardized on. Workbench's reverse-engineered
EER diagram is also a Phase 1 deliverable, and it is a MySQL tool.

Rejected: PostgreSQL (better CTE and window-function ergonomics, richer
constraint support) and SQLite (trivial setup, but no stored procedures, no real
concurrency story, and no capacity-race to demonstrate — which is precisely the
transaction-management material in zyBooks Ch. 6).

## 2026-09-17 — No ORM. Raw parameterized SQL only.

**Decision:** `mysql2/promise` with named placeholders. No Prisma, no TypeORM,
no Knex, no query builder "just for this one table."

Writing the SQL by hand **is** the graded work. An ORM would generate the joins,
hide the access paths, and make the EXPLAIN-driven tuning chapter (AGENT 16)
meaningless — you cannot defend an index you did not know your ORM was using.
It would also push logic that belongs in the database up into JavaScript, which
is the single failure mode this project is designed to avoid.

The cost is real and accepted: more boilerplate in repositories, and manual
mapping from result rows to response shapes. We contain it by confining all SQL
to the repository layer and naming every column explicitly (no `SELECT *`).

## 2026-09-17 — Two data sources: Kaggle for bulk, RAWG/IGDB for enrichment

**Decision:** Seed the game catalog from Kaggle Steam dumps, then enrich the
titles that matter with RAWG (cover art, genres, platforms, popularity).

Neither source alone is sufficient. Kaggle gives tens of thousands of real
titles with genres and release dates in one download — enough scale that the
matchmaking query and its indexes are worth optimizing. But Kaggle dumps are
stale and have no reliable cover art, and a browse page of games without cover
art demos badly. RAWG has current art and metadata but rate-limits, so it is
unusable for bulk load and perfect for enriching the ~300 games people actually
form groups around.

Consequence: the ETL is staged (`stg_*` → validated → core) with `etl_run` and
`etl_reject` bookkeeping, because two sources with different shapes and
different dirt need a place to put rows that fail. Silent drops are a bug.

## 2026-09-17 — `lfg_group.member_count` is a deliberate denormalization

**Decision:** Store a redundant member count on the group row, maintained
**exclusively** by triggers, and defend it with a reconciliation view.

The browse/matchmaking query filters and scores on open slots for every
candidate group. Computing `COUNT(*)` over `group_member` per candidate on the
hot path is the difference between an index range scan and an aggregate over
hundreds of thousands of rows.

This is the one place we accept redundancy, and we pay for it honestly:
`trg_group_member_*` are the only writers (application code writing this column
is a review rejection), and `v_member_count_reconciliation` exposes the drift
between the stored value and the true count. That view must always return zero
non-zero rows — it is the standing proof the denormalization is safe.

## 2026-09-17 — Availability is stored as UTC minutes-from-midnight

**Decision:** `availability_slot` stores `day_of_week` plus integer
`start_minute` / `end_minute` (0–1440) in **UTC**, converted from the user's
timezone at write time. Slots crossing midnight UTC are split into two rows.

The match score awards up to 15 points for overlapping availability. Expressed
as comparable integers, the overlap becomes pure arithmetic that a set-based SQL
expression can compute across every candidate at once:

```sql
SUM(GREATEST(0, LEAST(a.end_minute, b.end_minute)
              - GREATEST(a.start_minute, b.start_minute)))
```

Storing local times, or `TIME` values with a separate timezone column, would
force the comparison into application code — which is exactly anti-pattern C1.

The cost: one conversion function, in `@faze/shared`, used by both sides, with
tests covering a 22:00–02:00 slot, `Asia/Tokyo`, and a DST transition week. It
is the most bug-prone code in the project and it is quarantined in one file.

## 2026-09-17 — `DATETIME` in UTC, never `TIMESTAMP`

**Decision:** Every timestamp column is `DATETIME`, and the connection pool sets
`timezone: 'Z'`.

`TIMESTAMP` is silently converted between the session timezone and UTC on the
way in and out, and it runs out in 2038. `DATETIME` stores exactly what we wrote.
With `timezone: 'Z'` on the pool, nothing is reinterpreted by the driver either,
so a value written by the ETL at 02:00 UTC reads back as 02:00 UTC on a teammate's
laptop in a different zone. `message.created_at` is `DATETIME(3)` because message
ordering needs sub-second precision.

## 2026-09-17 — `JSON` columns for provenance only

**Decision:** `game.raw_payload` and `audit_log.old_values/new_values` are
`JSON`. No business logic ever queries inside them.

zyBooks Ch. 8 covers complex data types, and this is a justified use: we keep
the original API response so a future ETL run can re-derive a field we did not
think to extract, and the audit trigger records the full before/after row
without a column-per-field schema. But a `JSON` column is not indexable the way
a normalized column is, and querying business rules out of one would quietly
undo the normalization work. Anything the application branches on gets a real
column with a real type and a real constraint.

## 2026-09-17 — Keyset pagination everywhere, never OFFSET

**Decision:** Every list endpoint paginates on an opaque cursor encoding the
sort tuple. No endpoint uses `OFFSET`.

`OFFSET 10000` makes MySQL walk and discard 10,000 rows, so page 50 is
dramatically slower than page 1, and a concurrent insert shifts every subsequent
page (rows get duplicated or skipped). Keyset paging is O(log n) at any depth and
is stable under concurrent writes. AGENT 16 measures both and puts the comparison
in the report — the numbers are the argument.

## 2026-09-17 — Match scoring is one SQL query, not JavaScript

**Decision:** The entire scoring model lives in
`server/src/db/queries/match_groups.sql` as a parameterized CTE chain with a
computed `match_score` column and a `JSON_OBJECT` breakdown.

Scoring in Node would mean fetching every candidate group with its platforms,
tags, members' availability and activity, then sorting in memory — thousands of
rows over the wire to produce twenty. Worse, it would throw away the part of the
project that demonstrates joins, aggregation, conditional scoring, set-based
interval intersection and keyset pagination. This is anti-pattern C1, and it is
listed first for a reason.

## 2026-09-17 — Local development runs MySQL 8.0 where 8.4 is unavailable

**Decision:** `docker-compose.yml` and CI both pin `mysql:8.4`. Where the
container image cannot be pulled (a restricted network, for instance), a native
MySQL 8.0 server is an acceptable substitute for local development and evidence
gathering.

Everything the schema relies on — `CHECK` constraints (8.0.16+), CTEs, window
functions, `utf8mb4_0900_ai_ci`, `JSON`, `FULLTEXT` on InnoDB, `SELECT … FOR
UPDATE`, stored procedures and triggers — is present and behaves identically in
8.0 and 8.4. The pinned 8.4 in compose and CI remains the reference environment;
any 8.0-only workaround must be flagged in a PR rather than absorbed silently.

## 2026-09-17 — `react-router-dom` stays on v6 for now

**Decision:** Keep `react-router-dom` ^6.28 as the master prompt specifies,
despite two moderate advisories against 6.x (open redirect via backslash in
`<Link>`/`useNavigate`, and constructor injection via `deserializeErrors()` in
SSR hydration).

The fix is v7, a breaking change, and neither advisory is reachable as we use
the library: FAZE is a client-rendered SPA with no SSR hydration path, and every
navigation target is an internal route literal rather than a user-supplied URL.
AGENT 17 re-audits this with `npm audit --production`, verifies both conditions
still hold, and either records the accepted risk with that reasoning or performs
the v7 upgrade. Do not let this entry become the reason nobody looks again.

## 2026-09-17 — Out of scope, and staying out (§5.6)

Not building: voice chat (Discord exists; we link out), real skill/MMR inference
from gameplay APIs (self-reported rank only), payments or premium tiers, native
mobile apps (responsive web only), and a recommendation ML model.

The last one is the tempting one. The SQL match score **is** the feature — a
learned model would be a worse product here (cold start, no training data, no
explanation for the user) and would replace the graded database work with a
different subject's work. Scope discipline is itself a graded behavior in a
semester project.

---

## 2026-09-29 — Refresh tokens are opaque random values, not JWTs

**Decision:** The access token is a 15-minute HS256 JWT; the refresh token is 32
random bytes (base64url) stored only as its SHA-256 in `refresh_token`.

A JWT refresh token would be verifiable without a database read, but a refresh
token exists specifically so the server can say "no" — to a stolen copy, a
suspended account, a logged-out session. That needs a row to revoke, so the
statelessness would buy nothing and the signature would add a second thing to
get wrong. The access token is the opposite: it is checked on every request and
must not need a lookup, which is why it is a short-lived JWT and why a
suspension takes effect at the next refresh (≤ 15 minutes), not instantly.
`JWT_REFRESH_SECRET` in `.env.example` is therefore reserved and unused.

## 2026-09-29 — Rotate on every refresh; a replayed token ends every session

**Decision:** `POST /api/auth/refresh` revokes the presented token and issues a
new one. Presenting an already-revoked token revokes **all** of that user's live
refresh tokens and answers 401 `REFRESH_TOKEN_REUSED`.

A revoked token showing up again means either a stolen copy is being replayed or
the legitimate client raced itself; the server cannot tell which, and guessing
wrong in the lenient direction leaves a thief with a live session. Ending every
session is the safe answer and the cost (one re-login) is small. The check-then-
spend decision runs under `SELECT … FOR UPDATE`, the same mechanism that closes
the last-slot race in `sp_join_group`, so two simultaneous refreshes of one token
resolve to exactly one winner (tested). The revocation is decided _inside_ the
transaction and the error is thrown _after_ it commits — throwing from inside
would roll the revocation back and defeat the point.

## 2026-09-29 — Sign-in rate limit counts failures only

**Decision:** 5 attempts / 15 min / IP on register and the two reset endpoints
(every request counts); on sign-in only **failed** attempts count.

The threat on sign-in is password guessing, and failures are what that produces.
Counting successes as well punishes shared addresses — a classroom, a campus, or
the single proxy IP in front of a hosted demo — for their own legitimate logins,
which would lock the team out of its own demo. Registration and reset are the
mass-signup and email-flooding vectors, so every request counts there. Behind a
proxy, `trust proxy` must be configured (AGENT 19) or every visitor shares one
counter.

## 2026-09-29 — Account status is checked after the secret is proven

**Decision:** Sign-in verifies the password first and only then reports
`ACCOUNT_SUSPENDED` / `EMAIL_NOT_VERIFIED` / `ACCOUNT_DELETED`.

Checking status first would let anyone learn which accounts are suspended by
submitting a wrong password and reading the error. Unknown email and wrong
password return byte-identical 401s, and an unknown email still performs a full
argon2id verification against a precomputed dummy hash so response time does not
distinguish them either. Password reset answers 202 with an identical body for
known and unknown addresses. One residual difference is accepted: a real
address does extra database work and sends a message, so a patient attacker
timing that endpoint could infer existence; closing it would mean queueing the
work, which is not worth the complexity for this product.

## 2026-09-29 — Email goes through a `Mailer` interface; no provider is chosen yet

**Decision:** The application calls `Mailer.sendVerification / sendPasswordReset`.
There is no vendor implementation.

Picking SES, Resend or SendGrid needs an account and a verified sending domain —
an owner decision, not something to invent. Until then: in development the link
is printed to the server output (the one sanctioned place a token appears in
output, gated on `NODE_ENV=development`, because without a mail provider that
link is the only way to finish verification); in test a capturing mailer is
injected; in production nothing is sent and a warning says so _without_ the link.
`ALLOW_UNVERIFIED_LOGIN=true` activates accounts at registration for local
development, and the server refuses to boot with it set in production.

## 2026-10-02 — Scope cut: a smaller project that is easier to demo

**Decision:** We keep the main flow (register, profile, browse and match groups,
join, chat) and cut everything that only adds size. The full list is in
`docs/SCOPE.md`, which replaces the work-package list in
`FAZE_Master_Prompt_V1.txt` wherever the two disagree.

Why: this is a database class project. The graded parts are the schema, the SQL,
transactions and performance evidence, and they were being crowded out by
features nobody will grade. Working code that was already built (email
verification, password reset, token rotation, completeness scoring, extra
procedures and triggers) is **frozen, not deleted**: removing it would cost time
and risk breakage for no benefit.

Consequences, all deliberate:

- Email verification is off. Accounts are active on sign-up
  (`ALLOW_UNVERIFIED_LOGIN=true`). This supersedes the 2026-09-29 `Mailer` entry
  where it said the server refuses that setting in production: it now boots in
  production only when `DEMO_MODE=true` is also set, so skipping verification is
  always a visible, deliberate choice.
- No new tables, procedures, triggers or views. No more decision records.
- Chat refreshes by polling; there are no live sockets.
- Matching is one SQL score: 50 same game + 20 same region + up to 30 availability.
