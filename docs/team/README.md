# Team guide: how we work

Start here, then open **your own page**:

| Person          | Your page              | What you are building                                                   |
| --------------- | ---------------------- | ----------------------------------------------------------------------- |
| Bryan Djenabia  | [bryan.md](bryan.md)   | Matching query, performance evidence, ER diagram, Phase 1 and 2 hand-in |
| Alvin Hoang     | [alvin.md](alvin.md)   | Group messages API, one demo environment                                |
| Česko²          | [cesko2.md](cesko2.md) | Groups API (create, list, view, join, leave), short security check      |
| rita            | [rita.md](rita.md)     | Every screen the user sees                                              |
| Arman (Thrakos) | [arman.md](arman.md)   | Demo data, tests, data documentation                                    |

What we are and are not building is on one page: [`../SCOPE.md`](../SCOPE.md).
**If a task is not on your page, do not build it.** Ask in Discord first.

---

## One-time setup (about 20 minutes)

You need **Node 20 or newer**, **Git**, and **MySQL 8** (either Docker or a
normal install).

1. **Get the code.**
   ```bash
   git clone https://github.com/BryanD17/FAZE.git
   cd FAZE
   npm install
   ```
2. **Start MySQL.** Pick one:
   - With Docker: `docker compose up -d`
   - Without Docker: install MySQL 8 and create two empty databases called
     `faze` and `faze_test` (the README has the exact command).
3. **Create your settings file.** `cp .env.example .env`, then open `.env` and
   replace the two `replace-me…` secrets with random text. A quick way:
   `openssl rand -base64 48`. Never commit `.env`; Git already ignores it.
4. **Build the database and the game list.**
   ```bash
   npm run db:migrate     # creates the tables
   npm run etl:all        # loads the real game list (a few minutes, once)
   ```
5. **Start the app.** `npm run dev` — the API is at <http://localhost:4000>, the
   website at <http://localhost:5173>.
6. **Check it works.** Open <http://localhost:4000/api/health>. You should see
   `{"ok":true,"db":"up"}`.

If something fails, copy the **whole** error message into Discord
`#project-ideas`. Do not guess at fixes.

---

## Every task follows the same eight steps

1. **Update your copy of `main`.**
   ```bash
   git switch main
   git pull origin main
   ```
2. **Make a branch for the task.** Use a short descriptive name.
   ```bash
   git switch -c groups-api
   ```
3. **Do the task.** Keep to the files listed on your page.
4. **Check your work.** All three must pass:
   ```bash
   npm run lint
   npm run format        # fixes spacing automatically
   npm test
   ```
5. **Commit with a clear message.**
   ```bash
   git add <the files you changed>
   git commit -m "Add endpoint to join a group"
   ```
6. **Push your branch.** `git push -u origin groups-api`
7. **Open a pull request (PR) into `main`.** GitHub shows a short template: say
   what you did, how you checked it, and paste a little proof (see below).
8. **Wait for the two green checks, then for Bryan.** Bryan reviews and merges.
   Please **do not merge your own PR** and **never push straight to `main`.**

**If your PR says it has conflicts:**

```bash
git fetch origin
git merge origin/main
# open the files Git lists, keep both sides' intent, save
git add .
git commit
git push
```

Ask Bryan for help if the conflict is in a file you do not recognise.

### What "proof" means

A sentence is not proof; a pasted result is. Good examples:

- the last lines of `npm test` ("12 passed");
- the JSON an endpoint returned (`curl` output or a screenshot of the browser);
- a screenshot of the screen you built;
- the result of a SQL query you ran.

Two to four lines of real output is enough. No long reports.

---

## Rules that keep the project healthy

- **Only the repository layer talks to the database.** Request handlers and
  services never write SQL. SQL lives in `server/src/repositories/`.
- **Every SQL value goes in as a parameter** (`?`), never glued into the string.
- **Use the shared types.** Request and response shapes live in `shared/`. After
  changing `shared/`, run `npm run build --workspace=@faze/shared`.
- **Never commit secrets.** No passwords, keys or `.env` files.
- **Small PRs.** One task, one PR. Easier to review and easier to undo.
- **Add no new tables, procedures, triggers or views** without asking Bryan. We
  already have enough to explain.

## Where things are

| You want to…                      | Look in                              |
| --------------------------------- | ------------------------------------ |
| See every table and why it exists | [`../schema.md`](../schema.md)       |
| See every endpoint and its JSON   | [`../api.md`](../api.md)             |
| Understand the game data import   | [`../data.md`](../data.md)           |
| Know why a choice was made        | [`../decisions.md`](../decisions.md) |
| See what is in and out of scope   | [`../SCOPE.md`](../SCOPE.md)         |
