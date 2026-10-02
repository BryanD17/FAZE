# Arman (Thrakos) — your tasks

**Your goal in one sentence:** fill the database with believable demo people and
groups, and write a small set of tests that prove the database rules work.

First read the shared workflow in [README.md](README.md). This page lists only
_your_ work.

## Already done for you

- ✅ The **real game list**: 118,001 games imported from a Steam dataset, with
  genres, platforms and a multiplayer flag. The import scripts are in `db/etl/`
  and the explanation is in [`../data.md`](../data.md). It is finished.
- ✅ 55 automated tests already run in CI (login, profiles, the transaction
  helper). Look at `server/tests/auth.test.ts` to see how a test is written.

## Your tasks, in order

### Task 1 — Demo data script (about 4 hours)

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

### Task 2 — A small set of important tests (about 4 hours)

Not a huge matrix. Put each group of tests in its own file under `server/tests/`
and follow the style of `auth.test.ts`. Aim for **about 15 tests**:

1. **Database rules** (`integrity.test.ts`), each proving the database says no:
   - inserting a `group_member` for a user that does not exist fails (foreign key);
   - two users with the same email fails (unique);
   - a group with `max_members` of 1 or 50 fails (check rule);
   - the `member_count` of a group goes up when someone joins and down when they
     leave (trigger).
2. **The transaction example** — Česko² writes the 8-people-one-seat test in
   `groups.test.ts`. Review it: does it really fire all eight at once? Run it
   five times in a row; it must pass every time.
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

### Task 3 — Finish the data write-up (about 1 hour)

Open [`../data.md`](../data.md). Check that it answers, in plain language:
where the data came from, how many rows came in, how many were rejected and why,
and how to re-run the import. Fix any sentence that is out of date. Add one
paragraph: "RAWG cover art is not used; the website shows a placeholder."

### Task 4 — Quick manual check before each hand-in (about 30 minutes)

Before Oct 19 and before Dec 7, walk through the demo script in `docs/demo.md` in
a private browser window. Write down anything that fails as a GitHub issue,
with the page and what you saw.

## Not on your list any more

Realistic-at-scale data, a data quality dashboard, enterprise test coverage, the
RAWG enrichment run.

## Questions

Ask Bryan in `#project-ideas`, or comment on your GitHub issue.
