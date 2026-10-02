# Alvin Hoang — your tasks

**Your goal in one sentence:** give the screens the lists they need, finish the group chat on the
server side, and make the whole project run for a demo with as little fuss as
possible.

First read the shared workflow in [README.md](README.md) (it explains branches
and pull requests). This page only lists _your_ work.

## Already done (thank you)

- ✅ **Profiles** (PR #11): display name, region, platform, games, tags and
  availability, all saved to MySQL. This part is finished. We only touch it
  again to fix a bug.
- ✅ **Login, register, logout** are working. Email verification, password reset
  and token rotation exist in the code but are **frozen** — please do not extend
  them.

## Your tasks, in order

### Task 1 — Lookup lists for the profile form (about 1 hour, **do this first**)

rita's profile and group forms need drop-downs for regions, languages,
platforms and play-style tags, and no route returns them yet. She is blocked
until it exists.

1. Branch: `git switch -c lookups-route`.
2. Add `server/src/repositories/lookup.repo.ts` with one function that runs four
   plain `SELECT`s (tables `region`, `language`, `platform`, `playstyle_tag` —
   check the exact names in [`../schema.md`](../schema.md)) and returns
   `{ regions, languages, platforms, tags }`, each a list of `{ id, name }` (add `code` where the table has one).
3. Add `GET /api/lookups` (public, no login) in a new `routes/lookups.ts` and
   mount it in `server/src/app.ts` under `/api/lookups`.
4. One test: the reply has at least 5 platforms and 8 regions.
5. Add the route to [`../api.md`](../api.md), run the checks, open the PR.

**You are done when:** `curl localhost:4000/api/lookups` prints the four lists.

### Task 2 — Messages API (about 3–4 hours)

Group members can read and write messages in their group. Messages are stored in
the existing `message` table.

1. Make a branch: `git switch -c messages-api`.
2. Read the `message` table in [`../schema.md`](../schema.md) and the migration
   `db/migrations/0005_init_social.sql`. You do **not** need a new table.
3. In `server/src/repositories/` create `message.repo.ts` with two functions:
   - `listMessages(groupId, limit, beforeId?)` — newest 50 by default, with the
     sender's display name (join to the `profile` table).
   - `insertMessage(groupId, userId, body)`.
4. In `server/src/services/` create `message.service.ts`. Before anything else it
   must check that the person **is an active member** of the group. If not,
   throw `new AppError('FORBIDDEN_GROUP_ROLE', 403, 'Join this group first.')`.
   (The helper `requireGroupRole('member')` in `server/src/middleware/` already
   does exactly this check — use it on the route if you prefer.)
5. Add a shared schema in `shared/src/schemas/message.ts`: `body` is text,
   1 to 1000 characters. Export it from `shared/src/index.ts`, then run
   `npm run build --workspace=@faze/shared`.
6. Add two routes (new file `server/src/routes/messages.ts`, mounted in
   `server/src/app.ts` under `/api/groups`):
   - `GET /api/groups/:id/messages`
   - `POST /api/groups/:id/messages`
7. Add 4 tests in `server/tests/messages.test.ts`:
   - a member can post and read back the message;
   - a non-member gets 403 on read;
   - a non-member gets 403 on post;
   - an empty message gets 400.
8. Add the two routes to [`../api.md`](../api.md) (3 lines each is plenty).
9. Run the checks from the shared workflow, push, and open the PR.

**You are done when:** the 4 tests pass and `curl` shows a message posted by one
test user appearing for another member of the same group.

**Do not build:** live sockets (Socket.IO), read receipts, editing, deleting,
typing indicators. The screen will simply ask for new messages every few
seconds.

> Heads-up: `GET/POST /api/groups/:id/...` needs the groups routes that Česko²
> is writing. Until they land, test with a group you create by calling
> `sp_create_group` in MySQL, or ask Česko² which branch to borrow.

### Task 3 — One demo environment (about 3 hours, do it after Phase 1)

Goal: **one clear way** to start the full project on any laptop, plus (only if
the instructor wants it) one hosted copy.

1. Make a branch: `git switch -c demo-environment`.
2. Write the steps in `docs/deployment.md` using plain language: install, copy
   `.env.example`, `docker compose up -d`, `npm run db:migrate`,
   `npm run etl:all`, `npm run db:seed` (Arman's script — it appears once his
   task is merged), `npm run dev`.
3. Run the steps yourself on a **clean folder** and fix anything that breaks.
4. If a hosted copy is needed: choose one free host (for example Render or
   Railway), set `NODE_ENV=production`, `DEMO_MODE=true`,
   `ALLOW_UNVERIFIED_LOGIN=true`, a real `JWT_ACCESS_SECRET`, and Express
   `trust proxy`. Write the exact settings in `docs/deployment.md`.
5. Open a PR.

**You are done when:** someone who has never seen the project follows
`docs/deployment.md` and reaches the login page without asking you anything.

**Do not build:** Kubernetes, load balancers, monitoring, backups, CI deploys.

### Task 4 — Group chat wiring (with rita)

rita builds the chat box on the group page. Help her wire it to your two
endpoints and fix any server bug she finds. No new work for you beyond that.

## Not on your list any more

Email sending, mail provider, profile completeness, privacy settings, deployment
hardening. These were cut — see [`../SCOPE.md`](../SCOPE.md).

## Questions

Ask Bryan in `#project-ideas`, or comment on your GitHub issue.
