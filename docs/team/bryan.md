# Bryan Djenabia — your tasks

**Your goal in one sentence:** write the one match query, prove the database is
fast and correct, and turn everything into the two hand-ins.

First read the shared workflow in [README.md](README.md). You are also the
reviewer and the only person who merges pull requests.

## Already done

- ✅ Project scaffold, CI, and review rules.
- ✅ Schema (29 tables), migration runner, game import, stored procedures,
  triggers, views, and the login system.
- ✅ Branch protection is **not** done yet — see step 1 below.

## Your tasks, in order

### Step 1 — Protect `main` (10 minutes, you only)

On GitHub: **Settings → Branches → Add rule** for `main`: require a pull request
with 1 approval, require the two CI checks ("lint, typecheck, build" and
"migrate and test against MySQL"), and block force pushes. This stops anyone
(including a script) from rewriting the shared history by mistake.

### Step 2 — Review and merge pull requests (ongoing)

For each PR from the team:

1. Do the two CI checks show green? If not, say what failed and wait.
2. Read the description: does it say what changed, and does it show real output?
3. Skim the files: SQL only in `server/src/repositories/`? No secrets? Only
   files the task needed?
4. If it is fine, **Squash and merge** and make sure the commit message is a
   clear one-line summary. If not, leave comments in plain words and ask for
   changes. Anything that does not match [`../SCOPE.md`](../SCOPE.md) goes back.

### Step 3 — The match query (about 4 hours)

1. Branch: `git switch -c match-query`.
2. In `server/src/repositories/match.repo.ts` write **one** SQL query that takes a
   user id and returns open groups ranked by score. The score is decided in
   [`../SCOPE.md`](../SCOPE.md): 50 for the same game, 20 for the same region,
   up to 30 for overlapping availability (hours per week, capped at 10).
   - Availability overlap is computed in SQL from `availability_slot` (times are
     stored in UTC, so a plain overlap works). Start from the existing view
     `v_user_availability_minutes`.
   - Leave out groups the user already belongs to and groups that are full.
   - Return: group card fields, `score`, and three flags `sameGame`,
     `sameRegion`, `overlapHours` so the screen can say why.
3. Add `GET /api/matches` (needs login) and a service that only passes the user
   id through.
4. Tests (`server/tests/match.test.ts`, about 4): same game ranks above a
   different game; same region ranks above a different region; more overlap ranks
   higher; a full group never appears.
5. Add a short **"How the score works"** section in `docs/matchmaking.md` with
   the SQL and an example with real numbers.

**Done when:** for a seeded user, `curl /api/matches` returns groups in an order
you can explain from the numbers.

**Do not build:** an explain endpoint, a candidate-ranking API, adjustable
weights, extra filters.

### Step 4 — ER diagram and normalisation text (about 4 hours)

1. Draw the ER diagram (draw.io, dbdiagram.io or MySQL Workbench's reverse
   engineer) from the real tables in [`../schema.md`](../schema.md). Export a PNG
   to `docs/er-diagram.png`. Optionally ask nickayvy to check it.
2. In `docs/normalization.md` explain, in plain English, how one messy table
   becomes 1NF, 2NF and 3NF with two or three concrete examples from FAZE.
   `schema.md` §4 already has a full walk-through — shorten it to one page.

### Step 5 — Performance evidence (about 3 hours, after the data is seeded)

Pick **three** queries only: browse groups, the match query, game search. For
each:

1. Run `EXPLAIN` **before** adding or changing an index and paste the result.
2. If it scans too many rows, add one index in a new migration
   (`db/migrations/0012_...`, with a `.down.sql`), run `EXPLAIN` again, paste.
3. Record both results in `docs/performance.md` with the row counts and one
   sentence of explanation each. If an index is already good, say so and show it.

### Step 6 — Optional extras (only if everything above is merged)

In this order: one read-only "database stats" page (counts and the popular-games
view), then scheduling one group session, then one simple rating. Stop whenever
time runs out.

### Step 7 — Phase 1 hand-in (due Oct 19, 11:59 pm)

1. Collect one paragraph from each teammate about their part.
2. Assemble: the ER diagram, the normalisation text, `docs/schema.md`, three or
   four key SQL queries (the match query, the join procedure, one view, one
   trigger), setup steps from the README, and screenshots.
3. Post the discussion and submit the link on Canvas. Re-open the link in a
   private window to check it works.

### Step 8 — Final check before Dec 7

Fresh clone → follow the README → run the demo script → confirm the report
matches what the app really does. Fix or remove any sentence that is not true.

## Not on your list any more

An OpenAPI generator, a frozen "enterprise" API contract, keyset pagination, an
admin console, a long list of decision records.

## Open items only you can do

- Branch protection (step 1).
- Delete the old merged branches on GitHub (the tools used here cannot):
  `agent/agent-00-01-foundation`, `agent/agent-02-etl`, `agent/agent-03-advanced-sql`,
  `agent/agent-04-auth`, `fix/pretest-migrates-test-db`, `claude/new-session-rui3z9`,
  `agent-05-profile`.
