# Česko² — your tasks

**Your goal in one sentence:** build the groups API on top of the stored
procedures that already exist, and double-check that the data is protected.

You work only on the server and the database. **No screen work**, as agreed.
First read the shared workflow in [README.md](README.md).

## Already done for you

The database side of groups is finished and tested (see
[`../schema.md`](../schema.md) §9):

| Procedure         | What it does                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sp_create_group` | Creates a group, its platforms and the owner's membership in one transaction.                                                                 |
| `sp_join_group`   | Adds a member safely. Locks the group row so two people cannot take the last seat. Returns a code such as `JOINED`, `FULL`, `ALREADY_MEMBER`. |
| `sp_leave_group`  | Removes a member.                                                                                                                             |

Views you can read from: `v_group_card` (one row per group, ready to show on a
card) and `v_member_count_reconciliation`.

## Your tasks, in order

### Task 1 — Groups API (about 5–6 hours)

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

### Task 2 — Short security check (about 2 hours)

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

### Task 3 — ER diagram, with Bryan (about 1 hour)

Bryan draws the diagram; you check it against the real tables. Open
[`../schema.md`](../schema.md), compare every table and relationship with the
picture Bryan shares, and tell him what is missing or wrong.

## Not on your list any more

Triggers for edge cases, new procedures, ownership succession, penetration
testing, a long security architecture document.

## Questions

Ask Bryan in `#project-ideas`, or comment on your GitHub issue.
