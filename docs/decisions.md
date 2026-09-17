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
