# rita — your tasks

**Your goal in one sentence:** build five simple, clean screens that let a person
sign up, set up a profile, find groups, and talk in one.

You never need to write SQL. Everything you need from the server is described in
[`../api.md`](../api.md). First read the shared workflow in [README.md](README.md).

## What exists now

- A `client/` folder on `main` with React, Vite and Tailwind already set up
  (colours and spacing are in `client/tailwind.config.js`).
- Your hero page on the branch `agent/agent-10-frontend-scaffold`. The layout and
  the words are good; we want to keep them.
- A working API: register, login, logout, profile, games (see `api.md`).

## Your tasks, in order

### Task 1 — Bring your homepage onto the new base (about 2 hours)

Your branch was started before the shared `client/` folder existed, so Git sees
the same files twice. The simplest fix is a fresh branch.

1. `git switch main && git pull origin main`
2. `git switch -c frontend-base`
3. Run `npm install` at the top of the project, then `npm -w @faze/client run dev`.
   Open <http://localhost:5173>.
4. Copy your hero page components from the old branch into
   `client/src/pages/Home.tsx` (view them with
   `git show agent/agent-10-frontend-scaffold:client/src/App.tsx`). Do **not**
   copy `package.json`, `vite.config.ts` or `tsconfig` files.
5. Replace your hand-written colours with the Tailwind colours already defined
   (`bg-surface`, `text-content-primary`, `accent`, …). We use a **dark** page
   with a **blue** accent (`#5B8CFF`) — no purple, no gradients on text.
6. Add routing with `react-router-dom` for these paths: `/`, `/login`,
   `/register`, `/profile`, `/groups`, `/groups/:id`, `/matches`.
7. Make one small helper in `client/src/lib/api.ts` that calls the server and
   sends the login token (see Task 2 for how login works).
8. Run the checks, open a PR, and **close issue #2** in the PR text.

**You are done when:** your homepage looks like before, the page is dark, and
clicking the links changes the URL without errors.

### Task 2 — Login, register and profile screens (about 5 hours)

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
`GET /api/lookups`, which Alvin is adding first. The exact fields the profile
routes accept are in [`../api.md`](../api.md) under "Profile and games".

Keep it plain: labels above fields, one primary button per form, error messages
in red text. No animations needed.

**You are done when:** a new person can register, log in, fill in a profile,
refresh the page and still see their data.

### Task 3 — Groups, matches and group detail (about 6 hours)

_Wait for Česko²'s groups API and Bryan's match API, or use the example replies
in `api.md` while you build._

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

### Task 4 — Screenshots (about 30 minutes)

Take one screenshot of each page and save them in `docs/screenshots/`. Bryan
puts them in the report.

## Not on your list any more

A design-system library, a big dashboard, an admin console, loading skeletons
and a special error screen for every possible failure, client unit tests. One
simple "Something went wrong, try again" message is enough.

## Questions

Ask in `#project-ideas`, or comment on issue #2 / your issue.
