# Project scope: what we keep and what we cut

> **Why this page exists.** FAZE started as a very large plan (21 work packages,
> hundreds of tests, a full admin console). For a database class project that is
> too much, and it puts the part that is graded — the database — at risk. After
> Alvin's review on 2 Oct 2026 the team agreed to **keep the project small, solid
> and easy to demo**.
>
> **Rule of thumb:** if a feature does not help show the database design, the
> SQL, or the main user flow, we do not build it.
>
> If this page and `FAZE_Master_Prompt_V1.txt` disagree, **this page wins.**

## The one user flow we are building

1. A person **registers** and **logs in**.
2. They fill in a **profile**: display name, region, platform, favourite games,
   play-style tags and weekly availability.
3. They **browse groups** and see a **match list**: groups ranked for them by a
   SQL score (shared game + same region + overlapping availability).
4. They open a **group page**, **join** it (and can **leave**), see the members,
   and read/post **messages**.

Everything in the sections below either supports this flow or is a small
optional extra.

## Keep / cut table

"Status" says what the repository already contains today (2 Oct 2026).

| Area              | Keep                                                                                 | Cut or simplify                                                                                        | Status today                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts          | Register, log in, log out                                                            | Email verification, password reset, refresh-token rotation and reuse detection, advanced rate limiting | **Built.** The advanced parts exist and are switched off or ignored. Nobody builds more here. Accounts are active on sign-up (`ALLOW_UNVERIFIED_LOGIN=true`). |
| Profiles          | Display name, region, platform, games, tags, availability                            | Completeness scoring, privacy tiers, age brackets, detailed public-profile permission rules            | **Built** (Alvin, PR #11). No more work except bug fixes.                                                                                                     |
| Games             | Real game dataset, search, genres, multiplayer flag                                  | RAWG enrichment, cursor/keyset pagination                                                              | **Built.** 118,001 games imported. Cover art stays empty (placeholder image in the UI).                                                                       |
| Groups            | Create, list, view, join, leave, see members                                         | Join-request approval, moderator roles, owner-succession edge cases                                    | Database part **built** (`sp_create_group`, `sp_join_group`, `sp_leave_group`). API routes **not built** — Česko².                                            |
| Matchmaking       | One SQL score: game + region + availability                                          | Explain endpoint, candidate-ranking API, many filter combinations, elaborate weights                   | **Built.** One SQL query behind `GET /api/matches`; see `docs/matchmaking.md`.                                                                                |
| Availability      | Weekly slots stored in UTC and used for matching                                     | DST and time-zone edge cases                                                                           | **Built.** One strategy: convert to UTC when saving. Done.                                                                                                    |
| Messages          | Basic group chat stored in the database                                              | Read receipts, editing, activity tracking, live sockets                                                | Table **built**. API and screen **not built** — Alvin and Rita. Plain "refresh every few seconds" is fine.                                                    |
| Sessions          | Optional: schedule one group session                                                 | Recurrence, countdowns, played-state workflow                                                          | **Optional.** Only if everything else is finished.                                                                                                            |
| Ratings           | Optional: one simple rating after a session                                          | Complex "who may rate whom" rules                                                                      | **Optional.** A rating trigger already exists; do not extend it.                                                                                              |
| Reports / admin   | Optional: one read-only "database stats" page                                        | Moderation console, suspend-user flows, ETL dashboards                                                 | **API built** (`GET /api/reports/summary`); the page itself is optional — rita.                                                                               |
| Demo data         | Realistic seeded users, groups, messages                                             | 600 users / 250 groups / 4,000 messages                                                                | **Not built.** Target: about 40 users, 15 groups, 200 messages — Arman.                                                                                       |
| ETL               | The real game import (done)                                                          | Retry/caching/enrichment infrastructure                                                                | **Built.** Finished; only documentation remains.                                                                                                              |
| Stored procedures | A few meaningful ones                                                                | One per action                                                                                         | **Built:** 6. We add **no more**.                                                                                                                             |
| Triggers          | Ones that clearly protect data                                                       | Obscure edge cases                                                                                     | **Built:** 7. We add **no more**. In the report we explain the 3–4 that are easiest to explain.                                                               |
| Views             | Group, profile, popularity, reporting views                                          | Views added only to raise the count                                                                    | **Built:** 6. We add **no more**.                                                                                                                             |
| Transactions      | One strong example: joining a full group safely                                      | An elaborate demo for every multi-step action                                                          | **Built and proven** (8 people race for one seat; exactly 1 wins).                                                                                            |
| Indexes           | Keep, and show before/after `EXPLAIN`                                                | Dozens of micro-optimisations                                                                          | Indexes **built.** Before/after evidence for 3 queries is in `docs/performance.md`.                                                                           |
| Security          | Password hashing, parameterised SQL, basic access control                            | Production-grade token/session architecture                                                            | **Built.** Česko² does one short review (see his guide).                                                                                                      |
| Testing           | Key database tests, CRUD, the join transaction, a few important API tests            | A huge test matrix, fuzzing every table, exhaustive client tests                                       | 55 tests exist. Arman adds a small, targeted set.                                                                                                             |
| Frontend          | Simple screens: login, profile, groups, match results, group detail                  | Big dashboard, admin UX, every loading/error state                                                     | Only a landing page exists (Rita).                                                                                                                            |
| Deployment        | One runnable demo environment                                                        | Production hardening                                                                                   | **Not done** — Alvin.                                                                                                                                         |
| APIs              | Only routes the user flow needs                                                      | 50+ endpoints                                                                                          | See the route budget below.                                                                                                                                   |
| Documentation     | ER diagram, normalisation, schema, key SQL, setup, performance evidence, screenshots | Big ADR library, enterprise API contract, internal architecture docs                                   | Schema and data docs exist. Bryan compiles the rest. **No more ADRs.**                                                                                        |

## Route budget

Counting what is already built, the API has **22 routes**:

| Group   | Routes | Notes                                                                                                                                                                                                       |
| ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health  | 1      | `GET /api/health`                                                                                                                                                                                           |
| Auth    | 8      | The demo uses 5: register, login, refresh (optional), logout, me. The other three (verify-email, request-password-reset, reset-password) are **frozen**: they work, nobody calls them, nobody extends them. |
| Profile | 11     | `/api/profile/...` — the demo uses all except `completeness`, which is **frozen**.                                                                                                                          |
| Games   | 2      | Search and popular.                                                                                                                                                                                         |

We are **not deleting** working code just to shrink the number. Instead we cap
what is still to be added at **about 11 new routes**:

| Owner    | New routes                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Česko²   | `GET /api/groups`, `POST /api/groups`, `GET /api/groups/:id` (includes members), `POST /api/groups/:id/join`, `POST /api/groups/:id/leave` |
| Bryan    | `GET /api/matches`                                                                                                                         |
| Alvin    | `GET /api/lookups` (drop-down lists), `GET /api/groups/:id/messages`, `POST /api/groups/:id/messages`                                      |
| Optional | `POST /api/groups/:id/sessions`, `POST /api/sessions/:id/rating`, `GET /api/reports/summary`                                               |

Anything not in this table needs Bryan's OK first.

## The matching score (decided)

For one person looking at one group:

| Part                     | Points   | How it is worked out                                                                             |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| Same game                | 50       | The group's game is in the person's game list.                                                   |
| Same region              | 20       | Group region equals the person's region.                                                         |
| Overlapping availability | up to 30 | Hours per week where the person is free **and** the group plays, capped at 10 hours = 30 points. |

Highest total first. Ties are broken by newest group. It is one SQL query. The
JavaScript only passes the user id in and returns the rows.

## Timetable

| Dates          | Goal                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2 – 8 Oct      | Rita rebuilds the frontend base (issue #2). Česko² builds the groups API. Arman writes the seed script. Bryan builds the match query.                              |
| 9 – 15 Oct     | Rita builds login, profile, groups and match screens. Alvin builds the messages API. Bryan writes the ER diagram and normalisation text. Arman adds the key tests. |
| 16 – 19 Oct    | Bryan assembles and submits **Phase 1** (due **19 Oct, 11:59 pm**). Everyone adds one paragraph about their part.                                                  |
| 20 Oct – 6 Dec | Group-detail chat screen, `EXPLAIN` evidence, one demo environment, optional extras, screenshots, final polish.                                                    |
| 7 Dec          | **Phase 2 due, 11:59 pm.**                                                                                                                                         |
