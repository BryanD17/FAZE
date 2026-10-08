# FAZE — Phase 1 report (draft)

**CS 514: Database Theory and Implementation — Fall 2026**
Team: Bryan Djenabia, Alvin Hoang, nickayvy

> **Status of this draft.** Everything below is taken from the repository and
> the running database. Items marked **[TO ADD]** depend on a teammate's work
> that is not merged yet; they are placeholders, not claims. Due **19 Oct 2026,
> 11:59 pm**.

## 1. What FAZE is

FAZE helps a gamer find a group to play with. A person saves the games they
play, their platform, region and weekly free time. FAZE then **ranks open
groups for them** with one SQL query, and they can join a group and chat with
its members.

The problem is that finding people to play with is still manual (Reddit threads,
a huge Discord channel, a game's random matchmaking). None of those look at the
things that decide whether a group sticks together: the same game, the same
region and **overlapping free time**. Those are relational facts, so a
well-designed database answers the question better than a chat channel does.

## 2. Database design

- **ER diagram:** [`er-diagram.md`](er-diagram.md) (two pictures, generated from
  the real tables). 29 application tables, 41 foreign keys, 21 `CHECK`
  constraints. Every foreign key has a deliberately chosen `ON DELETE` rule,
  explained in [`schema.md`](schema.md) §3.
- **Normalisation:** [`normalization.md`](normalization.md) walks one messy
  spreadsheet to 1NF, 2NF and 3NF. All tables are in BCNF except one deliberate,
  defended exception: `lfg_group.member_count` (see section 5).
- **Availability** is stored as UTC minutes since midnight, so "do two people
  overlap?" is plain integer arithmetic in SQL, with no time-zone logic in the
  query.

## 3. Real data

The game catalog comes from a public Steam dataset (the Kaggle source needs an
account token, so the same-shape public mirror was used and is documented in
[`data.md`](data.md)). It goes through a staging step, then a clean-up step that
records everything it refuses.

| Step                                | Rows                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Staged                              | 140,082 apps                                                           |
| **Loaded as games**                 | **118,001**                                                            |
| Rejected (and logged with a reason) | 22,081 = 17,891 demos + 2,282 duplicate slugs + 1,908 non-Latin titles |
| Flagged multiplayer                 | 22,821                                                                 |
| Genre links                         | 326,743 across 63 genres                                               |

Re-running the import gives identical counts. A deliberately corrupted file
costs only the damaged tail, not the whole run.

## 4. Database programming

| Object              | Purpose                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| 6 views             | Group cards, full profile, popularity, member-count check, and others                   |
| 6 stored procedures | Create / join / leave a group, decide a request, record a session, set the primary game |
| 7 triggers          | Keep `member_count` correct, record audit changes, check rating eligibility             |
| 12 migrations       | Numbered, idempotent, each with a tested rollback                                       |

### Key SQL 1 — one trigger keeps the denormalised count right

```sql
CREATE TRIGGER trg_group_member_ai
AFTER INSERT ON group_member
FOR EACH ROW
BEGIN
  IF NEW.state = 'active' THEN
    UPDATE lfg_group SET member_count = member_count + 1 WHERE group_id = NEW.group_id;
    UPDATE lfg_group SET status = 'full'
     WHERE group_id = NEW.group_id AND status = 'recruiting' AND member_count >= max_members;
  END IF;
END;
```

### Key SQL 2 — joining a group safely (the transaction example)

`sp_join_group` starts a transaction and **locks the group's row** before it
checks for a free seat, so two people cannot both take the last one:

```sql
START TRANSACTION;
SELECT max_members, member_count, visibility, ...
  INTO v_max_members, v_member_count, v_visibility, ...
  FROM lfg_group WHERE group_id = p_group_id
  FOR UPDATE;                       -- the lock
-- ... refuse with FULL / ALREADY_MEMBER / REQUIREMENT_* ...
INSERT INTO group_member (group_id, user_id, role, state)
VALUES (p_group_id, p_user_id, 'member', 'active')
ON DUPLICATE KEY UPDATE role = 'member', state = 'active', left_at = NULL;
SET p_result = 'JOINED';
COMMIT;
```

**Proof:** 8 people ran the procedure at the same moment for one free seat, three
times. Every time exactly **1 got `JOINED` and 7 got `FULL`**. Before the count
trigger existed the same test gave 8 of 8 `JOINED`, which is why the trigger and
the lock are both needed (full account: [`schema.md`](schema.md) §9.5).

### Key SQL 3 — a view that a screen can read directly

`v_group_card` joins group, game, region, owner and platforms and adds
`open_slots = max_members - member_count`, so no caller repeats that arithmetic.

### Key SQL 4 — the match query

The score is **50** (same game) **+ 20** (same region) **+ up to 30** (shared
weekly availability). The core of it:

```sql
:gameWeight * same_game
+ :regionWeight * same_region
+ LEAST(:availabilityWeight, :availabilityWeight * overlap_hours / :fullHours) AS score
```

with `overlap_hours` summed from the members' availability slots. The full query,
a worked example and the exact reply are in [`matchmaking.md`](matchmaking.md).
Four automated tests assert the exact scores and ordering.

## 5. The one deliberate denormalisation

`lfg_group.member_count` repeats something the database could count. The browse
and match queries read it for every group, so counting each time would be slow.
Only triggers may change it, and the view `v_member_count_reconciliation` shows
any difference (its `drift` column must always be 0). It was 0 for all 5,000
groups in the performance data set.

## 6. Performance

Measured with `EXPLAIN ANALYZE` on 20,000 users, 5,000 groups and 118,001 games
([`performance.md`](performance.md)):

| Query                               | Before              | After   |
| ----------------------------------- | ------------------- | ------- |
| Browse groups for a game and region | 5.47 ms (full scan) | 0.10 ms |
| Match query (median of 5)           | 295 ms              | 164 ms  |
| Game search                         | 81.6 ms (full scan) | 0.21 ms |

## 7. Security and access control

- Passwords are hashed with **argon2id**; the hash is never logged or returned.
- Every SQL value is a bound parameter; only repositories contain SQL.
- Protected routes require a signed-in user (tested). Restricting group data to
  members arrives with the groups and messages APIs.
  **[TO ADD — nickayvy's one-page check, `docs/security.md`]**

## 8. Testing

60 automated tests run in CI against a real MySQL (sign-in, profiles, the
transaction helper, lookups and the match query). **[TO ADD — nickayvy's key
database-integrity tests]**

## 9. Run it yourself

Setup is five commands in the [README](../README.md). The demo login and a
five-step click-through will be in `docs/demo.md` **[TO ADD — nickayvy]**.

## 10. Screenshots

**[TO ADD — nickayvy: login, profile, groups, matches, group detail; save in
`docs/screenshots/`]**

## 11. Who did what

| Person   | Part                                                                                                                                   | Paragraph                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Bryan    | Project setup and review, schema and migration runner, game data import, matching query, performance evidence, ER diagram, this report | This report                            |
| Alvin    | Sign-in, profiles (region, platform, games, tags, availability), lookup lists, messages API                                            | **[TO ADD — Alvin, 3–4 sentences]**    |
| nickayvy | Groups API, every screen, demo data, tests, security check                                                                             | **[TO ADD — nickayvy, 3–4 sentences]** |

## 12. What is still open (honest list)

- The groups API (PR #21) and the screens (PRs #24 to #26) are done. The messages API is in progress, so the chat box shows "not available yet".
- RAWG cover art is not loaded; the website shows a placeholder.
- Email sending is not built; accounts are active when they register.
- Optional extras (sessions, ratings, an admin stats page) only if time allows.

---

## Appendix — draft of the discussion post

> **FAZE — gaming group finder.** We built a MySQL-backed app that ranks groups
> for a gamer using one SQL score: same game, same region, and overlapping
> weekly availability. The schema is normalised to 3NF with one deliberate,
> trigger-protected denormalisation. We loaded 118,001 real Steam games, and we
> prove the "last seat" race is safe: eight simultaneous joins for one seat give
> exactly one winner, every time. Indexes were chosen with `EXPLAIN ANALYZE`
> evidence (for example game search 81.6 ms → 0.21 ms). **[Each teammate adds
> one sentence about their lane before posting.]**
