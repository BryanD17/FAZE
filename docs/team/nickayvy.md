# nickayvy — your tasks

**Your goal in one sentence:** build the groups API, the five screens, and the
demo data, so a person can sign up, find a group, join it and talk in it.

You are taking over the work that was first planned for three people, so this
page puts the tasks in the order that unblocks everybody else. Do them top to
bottom. First read the shared workflow in [README.md](README.md) (branches, pull
requests and local setup). Bryan reviews and merges every pull request.

## What is already done for you

- **Database:** all tables, the stored procedures `sp_create_group`,
  `sp_join_group` and `sp_leave_group`, the `v_group_card` view, and 118,001
  real games (see [`../schema.md`](../schema.md) and [`../data.md`](../data.md)).
- **Server:** register, log in and log out; profiles (`/api/profile/...`); game
  search; `GET /api/lookups` (drop-down lists); and `GET /api/matches` (groups
  ranked for a person). Every route and its JSON is in [`../api.md`](../api.md).
- **Website:** a `client/` folder with React, Vite and Tailwind set up. A hero
  page from a former teammate is on the branch `agent/agent-10-frontend-scaffold`;
  its layout and wording are worth keeping.
- **Tests:** 62 automated tests run in CI. `server/tests/match.test.ts` shows how
  to build users, games and groups inside a test.

## How much work this is

About **23 hours** before Phase 1 (due **19 Oct, 11:59 pm**) and about **8 hours**
after it. That is a lot for one person, so the tasks are in priority order.
**If time runs short, tell Bryan early** (comment on your GitHub issue) rather
than skipping something silently.

---

## Before Phase 1 (19 Oct)

### Task 1 — Groups API ✅ done (PR #21)

Alvin's messages API and your own screens both need it.

Five routes. **Groups are open-join**: always create them with
`visibility = 'open'`. There is no approval step.

1. Branch: `git switch -c groups-api`.
2. **Shared schemas** — `shared/src/schemas/group.ts`:
   - `createGroupSchema`: `gameId`, `title` (3–120 chars), `description`
     (optional, up to 1000), `regionId`, `languageId`, `maxMembers` (2–10),
     `platformIds` (list of ids).
   - `groupListQuerySchema`: optional `gameId`, `platformId`, `regionId`, and
     `page` (default 1). Page size is fixed at 20.
     Export both, then `npm run build --workspace=@faze/shared`.
3. **Repository** — `server/src/repositories/group.repo.ts` (the only file with
   SQL):
   - `createGroup(...)` calls `sp_create_group`. Pass `NULL` for `min_age`,
     `rank_floor` and `rank_ceiling`, `0` for `mic_required`.
   - `listGroups(filters, page)` selects from `v_group_card` with the filters and
     `LIMIT 20 OFFSET ?` (plain paging is fine).
   - `getGroup(id)` returns the card plus the member list (display name, role,
     joined date).
   - `joinGroup(userId, groupId)` and `leaveGroup(userId, groupId)` call the two
     procedures and return the result code.
4. **Service + controller** — turn result codes into HTTP answers:

   | Code from the procedure | HTTP answer                      |
   | ----------------------- | -------------------------------- |
   | `JOINED`                | 200 `{ "result": "JOINED" }`     |
   | `FULL`                  | 409, code `GROUP_FULL`           |
   | `ALREADY_MEMBER`        | 409, code `ALREADY_MEMBER`       |
   | `NOT_FOUND`             | 404                              |
   | anything else           | 409 with the code as the message |

5. **Routes** — `server/src/routes/groups.ts`, mounted in `server/src/app.ts`
   at `/api/groups`. All five need `requireAuth`:
   - `GET /api/groups`
   - `POST /api/groups`
   - `GET /api/groups/:id`
   - `POST /api/groups/:id/join`
   - `POST /api/groups/:id/leave`
6. **Tests** — `server/tests/groups.test.ts`. Required:
   - create a group, then see it in the list and in the detail;
   - the creator is listed as owner and `member_count` is 1;
   - a second user joins and the count becomes 2;
   - a full group returns `GROUP_FULL`;
   - **the race test:** 8 users try to join a group with 1 free seat at the same
     time (`Promise.all`); exactly 1 gets `JOINED`. This is the transaction
     example for the report, so keep it clear and well commented.
7. Add the five routes to [`../api.md`](../api.md).
8. Run the checks and open the PR.

**You are done when:** all tests pass, and `curl` shows create, list, join and
leave working with two different test users.

**Do not build:** join requests, approving or rejecting, moderator roles,
removing members, transferring ownership, invite links. (The procedures for
those exist; just do not call them.)

### Task 2 — Website base ✅ done (PR #24)

The old hero-page branch was started before the shared `client/` folder
existed, so Git sees the same files twice and cannot merge them. The simplest
fix is a fresh branch that reuses its page.

1. `git switch main && git pull origin main`
2. `git switch -c frontend-base`
3. Run `npm install` at the top of the project, then `npm -w @faze/client run dev`.
   Open <http://localhost:5173>.
4. Copy the hero page components from the old branch into
   `client/src/pages/Home.tsx` (view them with
   `git show agent/agent-10-frontend-scaffold:client/src/App.tsx`). Do **not**
   copy `package.json`, `vite.config.ts` or `tsconfig` files.
5. Replace the hand-written colours with the Tailwind colours already defined
   (`bg-surface`, `text-content-primary`, `accent`, …). We use a **dark** page
   with a **blue** accent (`#5B8CFF`) — no purple, no gradients on text.
6. Add routing with `react-router-dom` for these paths: `/`, `/login`,
   `/register`, `/profile`, `/groups`, `/groups/:id`, `/matches`.
7. Make one small helper in `client/src/lib/api.ts` that calls the server and
   sends the login token (see Task 3 for how login works).
8. Run the checks and open a PR. Mention your GitHub issue in the PR text.

**You are done when:** the homepage keeps the old layout and wording, the page is dark, and
clicking the links changes the URL without errors.

### Task 3 — Login, register and profile screens ✅ done (PR #25)

1. **Register page** (`/register`): email, password (at least 10 characters, one
   letter, one number), display name. Calls `POST /api/auth/register`. If the
   server says the email or display name is taken, show the message **under the
   matching box** (the reply tells you which with a `field` value).
   Then go straight to the login page.
2. **Login page** (`/login`): email + password. Calls `POST /api/auth/login`.
   The reply contains an `accessToken`. **Keep it in a normal JavaScript
   variable (or React state), not in `localStorage`.** Send it on every request
   as `Authorization: Bearer <token>`.
3. **Staying logged in:** when the site loads, call `POST /api/auth/refresh`
   once. If it works you get a new token and the person stays signed in; if it
   fails, show the login page. You do **not** need anything more complicated.
4. **Log out** button: `POST /api/auth/logout`, then clear the token.
5. **Profile page** (`/profile`): a simple form with display name, region,
   platform, play-style tags, a list of favourite games (search box using
   `GET /api/games/search?q=...`), and weekly availability (a small grid: day + start +
   end). Save with the routes under `/api/profile` listed in `api.md`.

The drop-down choices (regions, languages, platforms, tags) come from
`GET /api/lookups`, which already exists. The exact fields the profile
routes accept are in [`../api.md`](../api.md) under "Profile and games".

Keep it plain: labels above fields, one primary button per form, error messages
in red text. No animations needed.

**You are done when:** a new person can register, log in, fill in a profile,
refresh the page and still see their data.

### Task 4 — Groups, matches and group detail screens ✅ done (PR #26; the chat box waits for Alvin's API)

_Build this after Task 1 (your groups API). The match API already exists; its
reply is described in [`../matchmaking.md`](../matchmaking.md)._

1. **Groups page** (`/groups`): a list of cards (game, title, region, members
   "3 / 5"). Three drop-downs filter by game, platform and region. A "Create
   group" button opens a small form.
2. **Matches page** (`/matches`): same cards, sorted best first, each showing its
   score ("82 / 100") and a short reason ("Same game, same region").
3. **Group detail** (`/groups/:id`): title, game, member list, and a **Join** or
   **Leave** button. If the group is full, show "Group full" and disable Join.
4. **Chat box** on the group detail page, for members only: shows the last
   messages, a text box, and a Send button. Ask the server for new messages
   every 5 seconds (`setInterval` is fine — no sockets).
5. Games have no cover pictures right now. Show a grey box with the game's first
   letter instead.

**You are done when:** you can create a group, join it from a second account,
and both accounts see each other's messages.

### Task 5 — Demo data script (about 4 hours)

A script that fills an empty database with a small, realistic set of data, so
the demo has something to show. **Small is the goal**: about **40 users, 15
groups and 200 messages.**

1. Branch: `git switch -c demo-seed`.
2. Create `db/seeds/seed.js` (Node script, same style as `db/scripts/reset.js`).
   Add `"db:seed": "node db/seeds/seed.js"` to the root `package.json`.
3. The script must be safe to run twice: delete only the demo rows it created
   (all demo emails end in `@demo.faze`), then insert again.
4. Create **40 users** with believable names, a region, a platform or two,
   2–3 games from the **real** catalog (pick well-known multiplayer titles,
   e.g. search by name) and 3–6 weekly availability slots each.
   - Use the real Express API or the repository code to create users so
     passwords are hashed properly. Every demo user has the same password,
     for example `DemoPass123`.
   - Make sure a few people share the same game and region — that is what makes
     the matching demo interesting.
5. Create **15 groups** by calling the `sp_create_group` procedure, owned by
   different users, across different games and regions. Then add 2–4 members to
   each with `sp_join_group`. Leave a few groups with free seats and make **one
   group exactly full** (so the "Group full" message can be shown).
6. Add about **200 messages** spread over the groups, written by members, with
   plausible text ("anyone up for ranked tonight?").
7. At the end, print a short summary: users, groups, members, messages.
8. Create `docs/demo.md`: the demo login (`<name>@demo.faze` / the password) and
   a five-step click-through (log in → open profile → see matches → join a
   group → send a message).

**You are done when:** from an empty database, `npm run db:migrate`,
`npm run etl:all` and `npm run db:seed` produce the expected counts, and running
`db:seed` a second time gives the **same** counts (not double).

**Do not build:** hundreds of users, thousands of messages, random-text
generators, admin dashboards.

### Task 6 — Screenshots (about 30 minutes)

Take one screenshot of each page and save them in `docs/screenshots/`. Bryan
puts them in the report.

---

## After Phase 1 (19 Oct – 7 Dec)

### Task 7 — A small set of important tests (about 4 hours)

Not a huge matrix. Put each group of tests in its own file under `server/tests/`
and follow the style of `auth.test.ts`. Aim for **about 15 tests**:

1. **Database rules** (`integrity.test.ts`), each proving the database says no:
   - inserting a `group_member` for a user that does not exist fails (foreign key);
   - two users with the same email fails (unique);
   - a group with `max_members` of 1 or 50 fails (check rule);
   - the `member_count` of a group goes up when someone joins and down when they
     leave (trigger).
2. **The transaction example** — you wrote the 8-people-one-seat test in
   `groups.test.ts` (Task 1). Check it again: does it really fire all eight at
   once? Run it five times in a row; it must pass every time.
3. **Basic create / read / update / delete** for one thing, for example a
   profile: create, read, change a field, read again.
4. **Important API behaviour:** logged-out calls to protected routes return 401;
   a bad request body returns 400 with a message.

For each test, add a one-line comment saying **what it proves**. These comments
help when the team writes the report.

**You are done when:** `npm test` passes three times in a row from a freshly
migrated database.

**Do not build:** fuzz tests, a test for every table, browser tests, a coverage
target.

### Task 8 — Short security check (about 2 hours)

One page, not a report. Create `docs/security.md` with three headings and fill
each with what you actually checked:

1. **Passwords** — passwords are hashed with argon2id and never logged. Show the
   line of code (`server/src/services/passwords.ts`).
2. **SQL injection** — search the server for any SQL built by gluing strings.
   Command: `grep -rn "\${" server/src/repositories`. Every hit must be a
   fixed column name, never user input. List what you found.
3. **Who can do what** — fill in this table with the real result of trying it
   (use `curl`):

   | Action                      | Logged out | Logged in, not a member | Member |
   | --------------------------- | ---------- | ----------------------- | ------ |
   | See group list              |            |                         |        |
   | Join a group                |            |                         |        |
   | Read group messages         |            |                         |        |
   | Edit someone else's profile |            |                         |        |

If you find a real problem, open a GitHub issue and tell Bryan; fix it in a small
PR if it is easy.

### Task 9 — Finish the data write-up (about 1 hour)

Open [`../data.md`](../data.md). Check that it answers, in plain language:
where the data came from, how many rows came in, how many were rejected and why,
and how to re-run the import. Fix any sentence that is out of date. Add one
paragraph: "RAWG cover art is not used; the website shows a placeholder."

### Task 10 — Manual check before each hand-in (about 30 minutes)

Before Oct 19 and before Dec 7, walk through the demo script in `docs/demo.md` in
a private browser window. Write down anything that fails as a GitHub issue,
with the page and what you saw.

---

## Not on your list

A design-system library, a big dashboard, an admin console, loading skeletons for
every case, client unit tests, join requests and approvals, moderator roles,
ownership transfer, hundreds of demo users, fuzz tests for every table, a long
security report. See [`../SCOPE.md`](../SCOPE.md).

## Questions

Ask Bryan in `#project-ideas`, or comment on your GitHub issue.
