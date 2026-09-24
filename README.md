# FAZE — find your group

**CS 514: Database Theory and Implementation — Fall 2026**
Bryan D · Alvin · Česko² · rita · Arman

---

## What FAZE is

FAZE matches a gamer to a group of other real people who play the same game, on
the same platform, in the same region, at the same hours, with the same reason
for playing — and gets them into a lobby instead of another dead Discord.

(The name is a nod to FaZe, which started as a gaming group.)

## The problem

Finding people to play with is still a manual, low-signal process: Reddit LFG
threads, a "looking-for-group" channel in a 4,000-member Discord, or the game's
own random matchmaking, which pairs on skill and nothing else. None of these
model the things that actually determine whether a group sticks together: time
zone and availability overlap, platform, voice-comms preference, whether someone
wants to grind ranked or mess around, language, and age bracket.

Those are relational facts about people, games, and schedules — exactly the kind
of problem a well-normalized database plus a good query answers better than a
chat channel does. **The match score is a SQL query, not a JavaScript loop.**
That is the point of the project.

---

## The stack

| Layer        | Choice                                                             | Why                                                                      |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Database** | MySQL 8 (InnoDB, `utf8mb4_0900_ai_ci`)                             | Matches the course environment — Workbench, Sakila, zyBooks              |
| **SQL**      | Raw `mysql2/promise`, **no ORM**                                   | Writing the SQL by hand is the graded work; an ORM would hide it         |
| **Backend**  | Node 20 + Express 4 + TypeScript                                   | routes → controllers → services → repositories; SQL lives in one layer   |
| **Auth**     | argon2id + JWT access token + rotating httpOnly refresh cookie     | Real authentication, not a user id in localStorage                       |
| **Frontend** | React 18 + Vite + TypeScript + Tailwind                            | Hand-rolled component set; no heavyweight UI kit                         |
| **State**    | TanStack React Query                                               | Gives loading/empty/error/loaded states cheaply                          |
| **Shared**   | `@faze/shared` — zod schemas + inferred types                      | One contract; drift is a compile error, not a runtime `undefined`        |
| **Realtime** | Socket.IO                                                          | Persist to MySQL first, broadcast second — the DB is the source of truth |
| **Tooling**  | Docker Compose (MySQL + Adminer), ESLint, Prettier, GitHub Actions | All five machines match                                                  |
| **Data**     | Kaggle Steam datasets + RAWG/IGDB enrichment                       | A real catalog — the match query is meaningless against 12 rows          |

---

## Local setup

You need **Node 20+** and **Docker** (or a local MySQL 8).

```bash
git clone https://github.com/BryanD17/FAZE.git
cd FAZE

# 1. Install every workspace (root, shared, server, client)
npm install

# 2. Start MySQL 8.4 + Adminer
docker compose up -d
docker compose exec db mysql -uroot -proot -e "SELECT VERSION();"

# 3. Configure the environment (every variable is commented in the template)
cp .env.example .env

# 4. Create the schema and load reference data
npm run db:migrate
npm run db:status          # prints applied vs pending

# 5. Run the app (API on :4000, client on :5173)
npm run dev
```

Verify the stack is live:

```bash
curl localhost:4000/api/health
# {"ok":true,"db":"up"}
```

**Without Docker?** Point `DB_*` in `.env` at any MySQL 8 and create the
databases by hand:

```bash
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS faze
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  CREATE DATABASE IF NOT EXISTS faze_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

Adminer is on <http://localhost:8080> (server `db`, user `root`, password
`root`) for anyone without MySQL Workbench handy.

### Everyday commands

| Command              | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| `npm run dev`        | API + client with hot reload                            |
| `npm run build`      | Builds shared, server, client                           |
| `npm test`           | Runs every workspace's tests                            |
| `npm run lint`       | ESLint across all workspaces                            |
| `npm run format`     | Prettier, write mode                                    |
| `npm run db:migrate` | Applies pending migrations in order                     |
| `npm run db:status`  | Shows applied vs pending migrations                     |
| `npm run db:reset`   | Drop → recreate → migrate → seed (**development only**) |
| `npm run db:verify`  | Asserts every view, procedure, trigger and index exists |

---

## Who owns what

Every person owns a lane. Lanes do not overlap, so two people never edit the
same file for the same reason. **Nobody asks "what should I do" in Discord** —
read the PROGRESS LEDGER in `FAZE_Master_Prompt_V1.txt` and take the first
unclaimed item in your lane.

| Person                       | Lane                      | Owns                                                                                                          | Agents                         | Files                                                                                             |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Bryan Djenabia**           | Full-stack / project lead | Repo, CI, migration runner, API contract, matchmaking query, performance, Phase 1 & 2 deliverables, PR review | 00, 01(co), 07, 09, 16, 18, 20 | `/.github/`, `/db/scripts/`, `/server/src/db/`, matchmaking services, `/docs/`                    |
| **adhduy** (LilAlFrmdao)     | Full-stack                | Authentication, user accounts, profiles end-to-end, messaging (API + socket + UI), deployment                 | 04, 05, 08, 13(co), 19         | `/server/src/routes/auth.*`, `/server/src/realtime/`, `/client/src/features/{auth,profile,chat}/` |
| **Česko²** (Cesko2)          | Backend — **no UI work**  | Core schema DDL, groups/LFG backend, views + stored procedures + triggers, referential integrity, security    | 01(co), 03, 06, 17             | `/db/migrations/`, `/server/src/db/queries/`, `/server/src/repositories/`                         |
| **rita** (ritaatech)         | Frontend                  | The entire visual layer — design system, shell, routing, onboarding, browse, group detail, dashboard, chat UI | 10, 11, 12, 13(co)             | `/client/src/` — **sole owner** of `/client/src/components/ui/`                                   |
| **Arman** (ArmanA / Thrakos) | Data, ETL, QA             | Kaggle acquisition, staging→normalized ETL, data quality, realistic demo data, the test suite, manual QA      | 02, 14, 15                     | `/db/data/`, `/db/seeds/`, `/db/etl/`, `/server/tests/`, `/docs/data.md`                          |

Shared: the ER diagram is Bryan + Česko². The Phase 1 and Phase 2 discussion
posts are drafted from the repo and posted by Bryan — **every teammate adds one
paragraph about their own lane before it is posted.**

rita should never have to read SQL to build a screen. Her build spec is
`docs/api.md`.

---

## Timeline

| Milestone                            | Due                 | Points | Covered by |
| ------------------------------------ | ------------------- | ------ | ---------- |
| **Phase 1** — Draft Database Product |                     |        |            |
| Final Project Discussion             | **Oct 19, 11:59pm** | 50     | AGENT 18   |
| Information and Submission Link      | **Oct 19, 11:59pm** | 100    | AGENT 18   |
| **Phase 2** — Final Database Product |                     |        |            |
| Final Project Discussion             | **Dec 7, 11:59pm**  | —      | AGENT 20   |
| Information and Submission Link      | **Dec 7, 11:59pm**  | —      | AGENT 20   |

**Phase 1 scope** (all must be complete before Oct 19): agents 00–14 and 18 —
scaffold, schema, ETL, advanced SQL, auth, profiles, groups, matchmaking, chat,
API contract, the four frontend agents, demo data, and the Phase 1 deliverables.

**Phase 2 scope** (before Dec 7): agents 15–17, 19, 20 — the test suite,
EXPLAIN-proven performance work, security hardening, deployment, and final
verification.

Live status lives in the PROGRESS LEDGER of `FAZE_Master_Prompt_V1.txt`. That
file is the source of truth for what is left.

---

## How we work

- **Discord** `#project-ideas` for decisions, `#github-links` for PR links.
- **Every PR needs one review.** Bryan is the required reviewer; a second
  teammate reviews anything touching their lane.
- **One branch and one PR per agent**: `agent/agent-NN-<short-name>`.
  Direct pushes to `main` are forbidden.
- **One 20-minute sync per week in class** — standing, no need to schedule it.
- **Evidence or it did not happen.** A PR that says "works" with no pasted
  output gets sent back. See §1.8 of the master prompt.
- Engineering conventions (SQL, backend, frontend, git) are in §8 of
  `FAZE_Master_Prompt_V1.txt`. Anti-patterns that get a PR rejected are in §9.

> **⛔ Bryan — branch protection needs a human click.**
> Settings → Branches → add a rule on `main` requiring 1 approval and passing
> CI status checks, and disallow force pushes. `CODEOWNERS` is committed and
> makes you a required reviewer, but the protection rule itself cannot be set
> from the CLI without admin API access.

---

## Documentation

| Doc                                      | Purpose                                       | Owner  |
| ---------------------------------------- | --------------------------------------------- | ------ |
| [`docs/decisions.md`](docs/decisions.md) | Dated ADRs for every real decision            | all    |
| [`docs/schema.md`](docs/schema.md)       | Data dictionary + the normalization argument  | Česko² |
| [`docs/api.md`](docs/api.md)             | The frozen API contract (rita's build spec)   | Bryan  |
| [`docs/data.md`](docs/data.md)           | Sources, licenses, ETL mapping, quality       | Arman  |
| `docs/matchmaking.md`                    | The scoring model and query walkthrough       | Bryan  |
| `docs/frontend.md`                       | Tokens, components, the four-state rule       | rita   |
| `docs/testing.md`                        | How to run and extend the suite               | Arman  |
| `docs/performance.md`                    | Before/after EXPLAIN evidence                 | Bryan  |
| `docs/security.md`                       | Threat model, IDOR table, attack log          | Česko² |
| `docs/deployment.md`                     | Environments, env vars, deploy/rollback       | adhduy |
| `docs/demo.md`                           | Demo credentials and the click-through script | Arman  |

## Repository layout

```
/client/            React + Vite + TypeScript frontend
/server/            Express + TypeScript API (routes → controllers → services → repositories)
/shared/            zod schemas + inferred types, imported by BOTH sides
/db/
  migrations/       numbered, idempotent SQL — the only way the schema changes
  seeds/            deterministic demo data
  scripts/          migrate / rollback / reset / verify CLI runners
  etl/              Kaggle + RAWG pipeline
  data/             raw dumps and API cache (gitignored — reproducible)
/docs/              every written deliverable
/.github/           CI, PR template, CODEOWNERS
FAZE_Master_Prompt_V1.txt   the work order and the live progress ledger
```
