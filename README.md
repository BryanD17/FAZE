# FAZE — find your group

**CS 514: Database Theory and Implementation — Fall 2026**
Bryan Djenabia · Alvin Hoang · nickayvy

---

## What FAZE is

FAZE helps a gamer find other real people to play with. You tell it which games
you play, which platform and region you are on, and when you are free. It then
**ranks open groups for you** and lets you join one and chat with the members.

(The name is a nod to FaZe, which started as a gaming group.)

## The problem

Finding people to play with is still a manual, low-signal process: Reddit
threads, a "looking for group" channel in a huge Discord server, or the game's
own random matchmaking. None of these look at the things that decide whether a
group sticks together: the same game, the same region, and **overlapping free
time**.

Those are facts about people, games and schedules. That is exactly the kind of
problem a well-designed database answers well. **The match score is a SQL query,
not a JavaScript loop** — that is the point of the project.

## The user flow we are building

1. Register and log in.
2. Fill in a profile: display name, region, platform, favourite games,
   play-style tags and weekly availability.
3. See a ranked list of groups (the match list) and browse all groups.
4. Open a group, join or leave it, see who is in it, and send messages.

We deliberately keep the project **small and solid**. What is in and out is
written on one page: **[`docs/SCOPE.md`](docs/SCOPE.md)**.

---

## Where the project stands (23 Nov 2026)

**Phase 1 was handed in on 19 Oct. Phase 2 is due on 7 Dec.** The whole plan,
with owners and dates, is in **[`docs/PHASE2.md`](docs/PHASE2.md)**.

| Part                                                                         | Status                      |
| ---------------------------------------------------------------------------- | --------------------------- |
| Database: 29 tables, 6 views, 6 stored procedures, 7 triggers, 12 migrations | ✅ Done (Bryan)             |
| Real game data: 118,001 Steam games                                          | ✅ Done (Bryan)             |
| Sign-in, profiles with time zones, lookups, group messages                   | ✅ Done (Alvin, Bryan)      |
| Groups API, all screens, live chat, demo data                                | ✅ Done (nickayvy)          |
| Match query, ER diagram, normalisation, `EXPLAIN` evidence                   | ✅ Done (Bryan)             |
| Hosting: Vercel website, Render API, Aiven MySQL                             | ✅ Set up (nickayvy)        |
| Phase 1 hand-in: report, product PDF, deck, website                          | ✅ Handed in                |
| **Phase 2:** sessions and ratings, group editing, stats page                 | ⬜ Alvin (#48, #49, #51)    |
| **Phase 2:** availability grid, score breakdown, polish, new look            | ⬜ nickayvy (#52–#54)       |
| **Phase 2:** key tests, security page, live-site check                       | ⬜ nickayvy (#19, #43)      |
| **Phase 2:** baselines, scaling and concurrency experiments with charts      | ⬜ Bryan (#55), Alvin (#50) |
| **Phase 2:** literature review, error analysis, final document and deck      | ⬜ Bryan (#56, #57)         |

## Who does what

Every person has their own step-by-step page. **Open yours and follow it from the
top.** Do not start a task that is not on your page without asking first.

| Person                            | Phase 2 job                                                                         | Your page                                        |
| --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Bryan Djenabia** (project lead) | Experiments and baselines, literature review, final document, deck, hand-in         | [`docs/team/bryan.md`](docs/team/bryan.md)       |
| **Alvin Hoang**                   | Sessions and ratings, group editing, stats page, concurrency experiment, demo guide | [`docs/team/alvin.md`](docs/team/alvin.md)       |
| **nickayvy**                      | Availability grid, match card polish, new look, key tests, security page, live site | [`docs/team/nickayvy.md`](docs/team/nickayvy.md) |

The shared steps for branches, pull requests and setup are in
[`docs/team/README.md`](docs/team/README.md).

---

## Tech we use

| Layer        | Choice                                                             | Why                                                                            |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Database     | MySQL 8 (InnoDB, `utf8mb4`)                                        | Matches the course tools (Workbench, Sakila)                                   |
| SQL          | Hand-written, parameterised queries — **no ORM**                   | Writing the SQL is the graded work                                             |
| Server       | Node 20, Express, TypeScript                                       | Routes → controllers → services → repositories; SQL lives only in repositories |
| Website      | React, Vite, TypeScript, Tailwind                                  | Simple and fast to build                                                       |
| Shared types | `@faze/shared` (zod)                                               | The server and website agree on request shapes                                 |
| Game data    | Public Steam dataset (Kaggle-style CSVs)                           | A real catalog makes the match query meaningful                                |
| Tools        | Docker Compose (MySQL + Adminer), ESLint, Prettier, GitHub Actions | Everyone's machine behaves the same                                            |

---

## Run it on your computer

You need **Node 20 or newer** and either **Docker** or a local **MySQL 8**.

```bash
git clone https://github.com/BryanD17/FAZE.git
cd FAZE

# 1. Install everything
npm install

# 2. Start MySQL (and the Adminer web viewer)
docker compose up -d

# 3. Create your settings file, then open .env and replace the two
#    "replace-me" secrets with random text (openssl rand -base64 48)
cp .env.example .env

# 4. Create the tables and load the game list
npm run db:migrate
npm run etl:all          # a few minutes, only once

# 5. Start the app: API on :4000, website on :5173
npm run dev
```

Check that it works: open <http://localhost:4000/api/health>. You should see
`{"ok":true,"db":"up"}`.

**No Docker?** Install MySQL 8 and create two empty databases:

```bash
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS faze
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  CREATE DATABASE IF NOT EXISTS faze_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

Then point `DB_HOST`, `DB_USER` and `DB_PASSWORD` in `.env` at it. Adminer (a
web viewer for the database) is at <http://localhost:8080> if you used Docker
(server `db`, user `root`, password `root`).

### Everyday commands

| Command              | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Starts the API and the website with auto-reload        |
| `npm test`           | Runs all tests                                         |
| `npm run lint`       | Checks the code for mistakes                           |
| `npm run format`     | Fixes spacing and style automatically                  |
| `npm run build`      | Builds everything                                      |
| `npm run db:migrate` | Applies new database changes                           |
| `npm run db:status`  | Shows which changes are applied                        |
| `npm run db:reset`   | Wipes and rebuilds the database (**development only**) |
| `npm run db:verify`  | Checks every view, procedure, trigger and index exists |

---

## Timetable

| Dates           | Goal                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 – 8 Oct       | nickayvy builds the groups API and the website base. Bryan builds the match query.                                                                |
| 9 – 15 Oct      | nickayvy builds the main screens and the demo data script. Alvin builds messages. Bryan writes the ER diagram and normalisation text.             |
| 16 – 19 Oct     | **Phase 1 due 19 Oct, 11:59 pm** (discussion post 50 pts + submission link 100 pts). Bryan submits; everyone adds one paragraph about their part. |
| 20 Oct – 22 Nov | Hosting set up on Vercel, Render and Aiven.                                                                                                       |
| 23 Nov – 1 Dec  | Phase 2 features, built and merged (**feature freeze Tue 1 Dec**).                                                                                |
| 2 – 6 Dec       | Experiments, final screenshots, final document and deck, full demo check on Sun 6 Dec.                                                            |
| 7 Dec           | **Phase 2 due, 11:59 pm.**                                                                                                                        |

## How we work together

- **One task = one branch = one pull request.** Never push straight to `main`.
- **Bryan reviews and merges.** nickayvy may merge his own pull requests once
  both checks are green; everyone else waits for Bryan.
- **Feature freeze on Tue 1 Dec.** After that, only bug fixes go into `main`.
- **Show real output** (test results, a JSON reply, a screenshot) in your pull
  request. "It works" is not enough.
- Questions go in Discord `#project-ideas`; pull request links in `#github-links`.
- One short sync per week in class.

---

## Documentation

| Doc                                              | What is in it                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| [`docs/PHASE2.md`](docs/PHASE2.md)               | **The Phase 2 plan: tasks, owners, dates**                             |
| [`docs/SCOPE.md`](docs/SCOPE.md)                 | What we build, what we cut, route budget, match score, timetable       |
| [`docs/team/`](docs/team/)                       | One step-by-step page per person                                       |
| [`docs/er-diagram.md`](docs/er-diagram.md)       | The ER diagram, in two readable pictures                               |
| [`docs/normalization.md`](docs/normalization.md) | How the data reaches 3NF, in plain English                             |
| [`docs/matchmaking.md`](docs/matchmaking.md)     | How the match score works, with an example                             |
| [`docs/experiments.md`](docs/experiments.md)     | Phase 2 baselines, scaling, concurrency and weak spots, with charts    |
| [`docs/literature.md`](docs/literature.md)       | How other systems match players, and how FAZE differs                  |
| [`docs/performance.md`](docs/performance.md)     | `EXPLAIN` before/after for the three queries that matter               |
| [`docs/phase1-report.md`](docs/phase1-report.md) | The Phase 1 report                                                     |
| [`docs/phase1/`](docs/phase1/)                   | Phase 1 hand-in: the product document PDF and the website text         |
| [`docs/schema.md`](docs/schema.md)               | Every table, the foreign keys, normalisation, procedures, triggers     |
| [`docs/api.md`](docs/api.md)                     | Every endpoint and its JSON                                            |
| [`docs/data.md`](docs/data.md)                   | Where the game data came from and how it was cleaned                   |
| [`docs/hosting.md`](docs/hosting.md)             | How the hosted copy works (Aiven, Render, Vercel) and who sets up what |
| [`docs/decisions.md`](docs/decisions.md)         | Why we chose what we chose (dated)                                     |

Still to be written by their owners: `docs/security.md`, `docs/deployment.md`.

## What is in the repository

```
client/       the website (React)
server/       the API (Express): routes → controllers → services → repositories
shared/       request/response shapes used by both sides
db/
  migrations/ numbered SQL files — the only way the schema changes
  scripts/    migrate, rollback, reset, verify
  etl/        the game data import
  seeds/      demo data (npm run db:seed, see docs/demo.md)
docs/         all written documents
.github/      CI checks, pull request template, reviewers
```

> `FAZE_Master_Prompt_V1.txt` is the original, much larger work plan. It is kept
> for history. Where it disagrees with `docs/SCOPE.md`, **SCOPE.md wins.**
