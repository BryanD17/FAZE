# Run the FAZE demo from a fresh clone

This is the one local setup path for the Phase 2 demo. The hosted copy is
separate and is documented in [`hosting.md`](hosting.md).

## What you need

- Node.js 20 or newer
- Docker Desktop, or MySQL 8 running locally
- Git

## 1. Clone and install

```bash
git clone https://github.com/BryanD17/FAZE.git
cd FAZE
npm install
```

`npm install` should finish without an install error and build the shared
package during the `prepare` step.

## 2. Create `.env`

```bash
cp .env.example .env
```

Generate a real access-token secret:

```bash
openssl rand -base64 48
```

Open `.env` and replace `JWT_ACCESS_SECRET=replace-me-...` with that value.
Keep these local demo settings:

```env
NODE_ENV=development
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=faze
DB_NAME_TEST=faze_test
CLIENT_ORIGIN=http://localhost:5173
ALLOW_UNVERIFIED_LOGIN=true
DEMO_MODE=false
```

Do not commit `.env` or any real password/secret.

## 3. Start MySQL

With Docker:

```bash
docker compose up -d
```

Check it:

```bash
docker compose ps
```

The MySQL service should be running on port `3306`.

If you use a local MySQL installation instead of Docker, create both databases
once:

```bash
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS faze
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  CREATE DATABASE IF NOT EXISTS faze_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

Then set `DB_USER` and `DB_PASSWORD` in `.env` to your local MySQL account.

## 4. Create the schema

```bash
npm run db:migrate
```

A fresh database should apply all migrations without an error. You can confirm
with:

```bash
npm run db:status
```

Every migration should show `[applied]`.

## 5. Load the real game catalog

```bash
npm run etl:all
```

This downloads and imports the Steam data. It is the slowest setup step and
only needs to be done once for a fresh database. The project should end with a
populated `game` table; the demo seed expects the real game slugs to exist.

## 6. Load demo users, groups and chat

```bash
npm run db:seed
```

The summary should end with:

```text
users:       40
groups:      15 (1 full)
members:     51
messages:    200
drift rows:  0 (must be 0)
```

The seed is safe to run again when you want to reset the demo data.

## 7. Start FAZE

```bash
npm run dev
```

Open:

- Website: <http://localhost:5173>
- API health check: <http://localhost:4000/api/health>

The health check should return:

```json
{"ok":true,"db":"up"}
```

## 8. Sign in to prove the demo is ready

Go to <http://localhost:5173/login> and use:

```text
Email:    maya@demo.faze
Password: DemoPass123
```

You should reach Maya's profile and be able to open Groups, Matches and a group
chat. The full click-through is in [`demo.md`](demo.md).

## If it does not work

| Problem | Fix |
| --- | --- |
| `ECONNREFUSED` to MySQL or `/api/health` says `"db":"down"` | Start MySQL first. With Docker, run `docker compose up -d`. |
| Docker says port `3306` is already in use | A local MySQL server is already using that port. Use that MySQL instance, stop it before Docker, or change the Docker port and `DB_PORT` together. |
| Server says `JWT_ACCESS_SECRET` is still the placeholder | Generate a new value with `openssl rand -base64 48` and put it in `.env`. |
| `npm test` cannot find `faze_test` | Create the `faze_test` database using the command in step 3. |
| `db:seed` says games are missing | Run `npm run etl:all` before `npm run db:seed`. |
| Login requests from the Vite site show proxy `ECONNREFUSED` | The Express server on port `4000` did not start. Read the server terminal for the first error. |
| Safari logs out after a local reload | Set `COOKIE_SECURE=false` in local `.env`. Do not use that setting for the hosted production demo. |

## Hosted demo

The live architecture is already set up as Vercel (website and `/api` proxy) →
Render (Express API) → Aiven (MySQL). See [`hosting.md`](hosting.md) for the
exact hosted settings. A custom domain is not required.
