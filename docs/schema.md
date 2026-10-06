# FAZE schema — data dictionary, keys, and the normalization argument

**Owner:** Bryan · **Engine:** MySQL 8, InnoDB,
`utf8mb4_0900_ai_ci` · **Source of truth:** `db/migrations/0001`–`0005`

This document is the written half of the database design. Section 4 (the
normalization walkthrough) is Phase 1 report material and is written as prose
for a reader, not as bullet fragments.

---

## 1. Design principles applied throughout

**Every table is InnoDB and `utf8mb4`.** InnoDB for real foreign keys, row
locking and transactions — MyISAM has none of those, and the last-slot race in
`sp_join_group` is unsolvable without row locks. `utf8mb4` because game titles
and display names contain emoji and non-Latin scripts, and `utf8mb3` would
truncate them.

**Surrogate keys everywhere except pure join tables.** `user_id`, `game_id`,
`group_id` are auto-increment integers. Join tables (`user_platform`,
`game_genre`, `group_member`, …) use the composite natural key instead, because
a surrogate id on a join table adds a column that nothing references and
permits the duplicate row the composite key structurally forbids.

**Every foreign key is named and has an explicit rule.** No `ON DELETE` is left
to the default. The full map with reasoning is §3.

**`NULL` means "unknown", never "zero" and never "false".** `game.release_date`
is `NULL` when the source date could not be parsed — not `1970-01-01`.
`user_game.rank_tier` is `NULL` for an unranked player, which is why an
unranked user is _not_ excluded from a ranked group's window (§5 of
`docs/api.md`).

**`DATETIME`, not `TIMESTAMP`.** `TIMESTAMP` silently converts between the
session timezone and UTC and expires in 2038. The pool sets `timezone: 'Z'`, so
what is written is what is read. `message.created_at` is `DATETIME(3)` because
message ordering needs millisecond precision for stable keyset pagination.

**`ENUM` for closed sets the application branches on; a lookup table for sets
that grow or carry attributes.** `user.status` and `group_member.role` are
ENUMs. `region`, `platform`, `genre` and `playstyle_tag` are tables — they have
names, slugs, descriptions, and in region's case an adjacency relation, none of
which an ENUM can hold.

---

## 2. Data dictionary

### 2.1 Reference data (`0001_init_lookup_tables.sql`)

#### `platform` — 5 rows

| Column                      | Type                     | Null | Default             | Meaning                                                                |
| --------------------------- | ------------------------ | ---- | ------------------- | ---------------------------------------------------------------------- |
| `platform_id`               | `TINYINT UNSIGNED` PK AI | no   | —                   | Narrow key; the M:N tables that carry it are read on every match query |
| `name`                      | `VARCHAR(30)` UQ         | no   | —                   | PC, PlayStation, Xbox, Switch, Mobile                                  |
| `slug`                      | `VARCHAR(30)` UQ         | no   | —                   | URL/filter form                                                        |
| `created_at` / `updated_at` | `DATETIME`               | no   | `CURRENT_TIMESTAMP` |                                                                        |

#### `region` — 8 rows

| Column      | Type                  | Null | Default | Meaning                                                                                                   |
| ----------- | --------------------- | ---- | ------- | --------------------------------------------------------------------------------------------------------- |
| `region_id` | `TINYINT UNSIGNED` PK | no   | —       | **Assigned by hand, not AUTO_INCREMENT**, so `region_adjacency` can be written as reviewable literal data |
| `code`      | `VARCHAR(10)` UQ      | no   | —       | `NA-East`, `EU-West`, `APAC`, …                                                                           |
| `name`      | `VARCHAR(40)` UQ      | no   | —       | Display name                                                                                              |

#### `region_adjacency` — 16 rows (8 pairs, both directions)

| Column               | Type               | Null | Meaning                  |
| -------------------- | ------------------ | ---- | ------------------------ |
| `region_id`          | `TINYINT UNSIGNED` | no   | PK part 1, FK → `region` |
| `adjacent_region_id` | `TINYINT UNSIGNED` | no   | PK part 2, FK → `region` |

Stored **symmetrically** (both `(1,2)` and `(2,1)`) so the matchmaking query
needs one indexed join rather than an `OR` across two columns, which would
prevent index use. `ck_region_adjacency_not_self` stops a region neighbouring
itself, which would double-count the same-region case.

#### `language` — 12 rows

`language_id` PK AI · `iso_code CHAR(2)` UQ (ISO 639-1) · `name` UQ.

#### `genre` — grows with the ETL

`genre_id` PK AI · `name` UQ · `slug` UQ. Upserted by slug during
staging→core transformation.

#### `playstyle_tag` — 9 rows

`tag_id` PK AI · `name` UQ · `slug` UQ · `description VARCHAR(140)`. The
description is user-facing copy for the onboarding chip picker; it lives with
the tag so the client does not duplicate it.

### 2.2 Game catalog (`0002_init_game_catalog.sql`)

#### `game`

| Column              | Type                  | Null | Meaning                                                                                                                                                    |
| ------------------- | --------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game_id`           | `INT UNSIGNED` PK AI  | no   |                                                                                                                                                            |
| `title`             | `VARCHAR(255)`        | no   |                                                                                                                                                            |
| `slug`              | `VARCHAR(255)` **UQ** | no   | Dedup key. Two rows for one game would split its groups into two populations that cannot find each other — the worst failure this product can have         |
| `release_date`      | `DATE`                | yes  | `NULL` when unparseable; never guessed                                                                                                                     |
| `steam_appid`       | `INT UNSIGNED` UQ     | yes  | Natural key, source 1                                                                                                                                      |
| `rawg_id`           | `INT UNSIGNED` UQ     | yes  | Natural key, source 2                                                                                                                                      |
| `igdb_id`           | `INT UNSIGNED` UQ     | yes  | Natural key, source 3                                                                                                                                      |
| `cover_url`         | `VARCHAR(500)`        | yes  | From RAWG enrichment                                                                                                                                       |
| `short_description` | `VARCHAR(1000)`       | yes  |                                                                                                                                                            |
| `metacritic`        | `TINYINT UNSIGNED`    | yes  | 0–100, `ck_game_metacritic_range`                                                                                                                          |
| `estimated_owners`  | `VARCHAR(40)`         | yes  | Steam publishes a _bucket_ string (`"1,000,000 - 2,000,000"`). Stored verbatim — converting it to a number would invent precision the source does not have |
| `is_multiplayer`    | `BOOLEAN`             | no   | Derived from Steam category strings. Groups may only form on `1`                                                                                           |
| `max_party_size`    | `TINYINT UNSIGNED`    | yes  | Parsed from `"4-player Co-op"`; `NULL` when unknown, never fabricated                                                                                      |
| `raw_payload`       | `JSON`                | yes  | **Provenance only** — see §5                                                                                                                               |

The three natural keys are each `UNIQUE` and nullable: MySQL permits many
`NULL`s in a unique index, which is exactly right when most games appear in
only one source. `ft_game_title` is a `FULLTEXT` index serving
`GET /api/games/search`.

#### `game_genre`, `game_platform`

Pure M:N join tables, composite PK, with a reverse index on the second column
for "which games are in this genre/on this platform".

### 2.3 Users and profiles (`0003_init_users.sql`)

#### `user` — authentication identity

| Column                               | Type                                             | Null | Meaning                                                                                          |
| ------------------------------------ | ------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------ |
| `user_id`                            | `INT UNSIGNED` PK AI                             | no   |                                                                                                  |
| `email`                              | `VARCHAR(255)` **UQ**                            | no   | Lowercased by the application before write, so uniqueness does not depend on collation behaviour |
| `password_hash`                      | `VARCHAR(255)`                                   | no   | argon2id; the width leaves room for a future parameter change                                    |
| `status`                             | `ENUM('pending','active','suspended','deleted')` | no   |                                                                                                  |
| `email_verified_at`, `last_login_at` | `DATETIME`                                       | yes  |                                                                                                  |

#### `profile` — public gamer profile, **1:1** with `user`

`user_id` is simultaneously the primary key **and** the foreign key. That
shared key is what makes the relationship 1:1 rather than 1:N — there is no
separate `profile_id` that could be duplicated for one user.

| Column          | Type                           | Null | Meaning                                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`       | `INT UNSIGNED` PK, FK → `user` | no   |                                                                                                                                                                                                                                                                                                                            |
| `display_name`  | `VARCHAR(40)` **UQ**           | no   |                                                                                                                                                                                                                                                                                                                            |
| `bio`           | `VARCHAR(500)`                 | yes  |                                                                                                                                                                                                                                                                                                                            |
| `avatar_url`    | `VARCHAR(500)`                 | yes  |                                                                                                                                                                                                                                                                                                                            |
| `birth_year`    | `SMALLINT UNSIGNED`            | yes  | **Year, not a full date of birth** — the product needs only an age bracket for the `min_age` requirement, and collecting the exact date would gather more personal data than the feature justifies. `ck_profile_birth_year` bounds it to 1940–2020, rejecting typos and future years that would silently pass an age check |
| `region_id`     | FK → `region`                  | yes  |                                                                                                                                                                                                                                                                                                                            |
| `language_id`   | FK → `language`                | yes  |                                                                                                                                                                                                                                                                                                                            |
| `timezone`      | `VARCHAR(64)`                  | no   | IANA name, validated against `Intl.supportedValuesOf('timeZone')`                                                                                                                                                                                                                                                          |
| `mic_available` | `BOOLEAN`                      | no   |                                                                                                                                                                                                                                                                                                                            |

**Why `user` and `profile` are split.** They have different access patterns
(auth data is read on every authenticated request; profile data on profile
views and matches), different sensitivity (a leaked `password_hash` is a
breach, a leaked `display_name` is a feature), and different lifetimes. One
table would mean every profile read pulls the password hash into memory, and
every `SELECT` over profiles would be one careless `SELECT *` away from putting
hashes in an API response.

#### `user_platform`, `user_tag`

M:N join tables, composite PK.

#### `user_game` — the library, an **associative entity**

| Column               | Type                                                           | Null | Meaning                                                                                                                                         |
| -------------------- | -------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`, `game_id` | composite PK                                                   | no   |                                                                                                                                                 |
| `self_rank`          | `VARCHAR(40)`                                                  | yes  | The game's own rank name — free text because every game names ranks differently (`"Gold 3"`, `"Ascendant"`, `"3200 MMR"`)                       |
| `rank_tier`          | `TINYINT UNSIGNED` 1–10                                        | yes  | The **normalized** tier that makes ranks comparable _across_ games. Free text cannot be compared; this is what a group's rank window filters on |
| `hours_played`       | `SMALLINT UNSIGNED`                                            | yes  | Self-reported                                                                                                                                   |
| `goal`               | `ENUM('casual','ranked','learning','completionist','content')` | no   |                                                                                                                                                 |
| `is_primary`         | `BOOLEAN`                                                      | no   | At most one per user, enforced by `trg_user_game_bi`                                                                                            |

This is the textbook case for an associative entity: rank, hours and goal are
properties of the **relationship** between a user and a game, not of either one
alone. Putting `rank` on `user` would be wrong (a player is Diamond in Valorant
and Bronze in Chess), and putting it on `game` would be absurd.

#### `availability_slot` — 1:N from `user`

| Column         | Type                       | Null | Meaning                   |
| -------------- | -------------------------- | ---- | ------------------------- |
| `slot_id`      | `INT UNSIGNED` PK AI       | no   |                           |
| `user_id`      | FK → `user`                | no   |                           |
| `day_of_week`  | `TINYINT UNSIGNED` 0–6     | no   | 0 = Sunday, **UTC**       |
| `start_minute` | `SMALLINT UNSIGNED` 0–1439 | no   | Minutes from UTC midnight |
| `end_minute`   | `SMALLINT UNSIGNED` 1–1440 | no   |                           |

Four CHECK constraints guard this table, and `ck_availability_slot_order`
(`end_minute > start_minute`) is the important one: an inverted slot would
contribute a _negative_ interval to the overlap `SUM` and silently corrupt
every match score it touched. `uq_availability_slot_user_day_start` prevents a
duplicate slot double-counting the same time.

**Why integers and not `TIME`.** See §5.

### 2.4 Groups (`0004_init_groups.sql`)

#### `lfg_group`

| Column                       | Type                                            | Null | Meaning                                                             |
| ---------------------------- | ----------------------------------------------- | ---- | ------------------------------------------------------------------- |
| `group_id`                   | `INT UNSIGNED` PK AI                            | no   |                                                                     |
| `owner_user_id`              | FK → `user`                                     | no   |                                                                     |
| `game_id`                    | FK → `game`                                     | no   |                                                                     |
| `title`                      | `VARCHAR(120)`                                  | no   |                                                                     |
| `description`                | `VARCHAR(1000)`                                 | yes  |                                                                     |
| `region_id`, `language_id`   | FK                                              | yes  |                                                                     |
| `visibility`                 | `ENUM('open','request','invite')`               | no   |                                                                     |
| `status`                     | `ENUM('recruiting','full','active','archived')` | no   | Flipped between `recruiting` and `full` by the membership triggers  |
| `max_members`                | `TINYINT UNSIGNED`                              | no   | `ck_lfg_group_max_members` 2–50                                     |
| **`member_count`**           | `TINYINT UNSIGNED`                              | no   | **The one denormalization — see §6**                                |
| `mic_required`               | `BOOLEAN`                                       | no   | Hard requirement                                                    |
| `min_age`                    | `TINYINT UNSIGNED`                              | yes  | Hard requirement: a user below it is _excluded_, not penalized      |
| `rank_floor`, `rank_ceiling` | `TINYINT UNSIGNED` 1–10                         | yes  | `ck_lfg_group_rank_window` enforces floor ≤ ceiling                 |
| `last_activity_at`           | `DATETIME`                                      | no   | Denormalized for the +3 recency component; written only by triggers |

#### `group_member` — M:N with lifecycle

`state ENUM('active','left','removed')`. The row is **kept**, not deleted,
because the match score subtracts 10 for a group the user previously left and
_excludes entirely_ a group they were removed from. A deleted row cannot
express either fact.

`ck_group_member_left_at` enforces the invariant that an `active` membership
has no `left_at` and a departed one must have it — without it, `left` rows with
a `NULL` `left_at` would silently corrupt any tenure or churn reporting.

#### `join_request`

`uq_join_request_group_user_state (group_id, user_id, state)` is deliberately
three columns. It stops a user stacking multiple **pending** requests at one
group (spam), while still allowing a denied request and a later approved one to
coexist in history. A `UNIQUE (group_id, user_id)` would make re-applying after
a denial impossible.

`ck_join_request_decided_at` keeps `state` and `decided_at` consistent.

#### `play_session`

`ck_play_session_duration` bounds 15–1440 minutes, which catches a units
mix-up (minutes entered as seconds) as well as a zero-length session.

### 2.5 Social (`0005_init_social.sql`)

#### `message`

`message_id BIGINT UNSIGNED` — this is the one table with a genuinely unbounded
growth rate, and widening a primary key later is an expensive table rebuild.
`idx_message_group_time (group_id, created_at, message_id)` serves the
backwards keyset page. `deleted_at` is a soft delete so the API can return a
tombstone rather than leaving a hole in client-side ordering.

#### `rating`

`PRIMARY KEY (rater_user_id, ratee_user_id, session_id)` expresses "one rating
per pair per session" **structurally** — no application check, and no race can
produce a duplicate. `ck_rating_not_self` blocks free self-reputation;
eligibility beyond that (both users actually in the session's group) requires
reading other tables, which a CHECK cannot do, so it lives in `trg_rating_bi`.

#### `report`

`reason` and `state` ENUMs, indexed on `(state, created_at)` for the admin
queue.

#### `audit_log`

Deliberately generic: `table_name` + `row_pk` + `action` + `old_values`/
`new_values` JSON. A typed column-per-audited-field design would need a
migration every time a new column became sensitive; this one needs a trigger.
`actor_user_id` is nullable because a trigger cannot always know who acted — a
change made by the ETL or a migration has no user behind it, and claiming one
would be worse than recording `NULL`.

### 2.6 Authentication tokens (`0011_auth.sql`)

Three single-purpose tables. In each, only the SHA-256 of a token is stored
(`token_hash CHAR(64)` primary key); the raw value exists only in the email link
or the httpOnly cookie that carries it, so a leaked database cannot be replayed.
Tokens are 32 random bytes, so an unsalted hash is sufficient — there is nothing
to brute-force. All three cascade-delete with their `user`.

| Table                | Extra columns                                       | Rules                                                                                                                                                             |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email_verification` | `user_id`, `expires_at`, `used_at`                  | Single use, 24 h expiry.                                                                                                                                          |
| `refresh_token`      | `user_id`, `expires_at`, `revoked_at`, `user_agent` | Rotated on every use; presenting a revoked token revokes all of the user's tokens. `idx_refresh_token_user_revoked (user_id, revoked_at)` serves that revocation. |
| `password_reset`     | `user_id`, `expires_at`, `used_at`                  | Single use, 1 h expiry; requesting a new link retires older unused ones.                                                                                          |

Timestamps are UTC values written by the application and compared against the
application clock; nothing here depends on `NOW()` or the MySQL session zone.
Expired rows are not yet purged — a periodic cleanup is future work.

---

## 3. The foreign key map

37 foreign keys. Every one is named `fk_<child>_<parent>` and carries an
explicit rule. `ON UPDATE` is `RESTRICT` almost everywhere because every parent
key is a surrogate that never changes; the interesting choice is `ON DELETE`.

| Child → Parent                                                                            | ON DELETE    | Why this rule                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile` → `user`                                                                        | CASCADE      | A profile without its account is meaningless                                                                                                                                             |
| `user_platform`, `user_tag`, `user_game`, `availability_slot` → `user`                    | CASCADE      | All are parts of one person's profile                                                                                                                                                    |
| `profile` → `region`, `language`                                                          | **SET NULL** | If a region were retired the person still exists and keeps their account. They lose one match component until they re-pick — recoverable. Losing the profile is not                      |
| `user_game` → `game`                                                                      | **RESTRICT** | A game with players in their libraries must not vanish from the catalog under them. An ETL run that wants to remove it has to reckon with the people who play it                         |
| `lfg_group` → `game`                                                                      | **RESTRICT** | Same, more strongly: a live group whose game disappeared is unrepairable                                                                                                                 |
| `lfg_group` → `user` (owner)                                                              | CASCADE      | Deleting an account removes the groups it owns. Note this is the _account deletion_ path — when an owner merely **leaves**, `sp_leave_group` promotes a successor and the group survives |
| `lfg_group` → `region`, `language`                                                        | SET NULL     | As for `profile`                                                                                                                                                                         |
| `group_platform`, `group_member`, `join_request`, `play_session`, `message` → `lfg_group` | CASCADE      | All are parts of one group                                                                                                                                                               |
| `group_member`, `message` → `user`                                                        | CASCADE      | Deleting an account removes that person's memberships and messages. `SET NULL` would leave orphaned text a user asked to have removed                                                    |
| `join_request.decided_by_user_id` → `user`                                                | **SET NULL** | If the moderator who decided a request deletes their account, the decision still happened; the record survives minus the attribution                                                     |
| `rating` → `user` ×2, `play_session`                                                      | CASCADE      |                                                                                                                                                                                          |
| `report` → `user` ×2                                                                      | CASCADE      |                                                                                                                                                                                          |
| `report` → `lfg_group`                                                                    | **SET NULL** | The group may be archived and cleaned up, but a report about a person's conduct must outlive its context                                                                                 |
| `audit_log` → `user`                                                                      | **SET NULL** | Never CASCADE. Deleting an account must not erase the audit trail of what that account did — that is the entire point of an audit log                                                    |
| `*_platform` → `platform`                                                                 | RESTRICT     | Reference data; removing a platform is a schema decision, not a row deletion                                                                                                             |
| `region_adjacency` → `region` ×2                                                          | CASCADE      | An adjacency to a region that no longer exists is meaningless                                                                                                                            |

One rule was **forced rather than chosen**: `region_adjacency`'s foreign keys
use `ON UPDATE RESTRICT` because MySQL refuses to let a column carry both a
`CHECK` constraint and a foreign key referential action
(`Column 'region_id' cannot be used in a check constraint … needed in a foreign
key constraint referential action`). RESTRICT is correct here anyway — region
ids are assigned by hand in the migration precisely so they never change.

---

## 4. Normalization: from one big spreadsheet to 3NF

The honest starting point for a project like this is the spreadsheet a person
would actually build: one row per "gamer looking for a group", with everything
about them and the group beside them.

### 4.0 The unnormalized relation

```
GAMER_SHEET(
  email, display_name, birth_year, region_code, region_name, language,
  timezone, mic, platforms_owned, games_played, ranks, hours,
  playstyle_tags, availability,
  group_title, group_game, group_platforms, group_region, group_max,
  group_members, group_requirements, last_message, last_message_at
)
```

A sample row:

```
duy@x.com | adhduy | 2003 | NA-East | North America East | English | America/New_York
  | yes | "PC, Switch" | "Valorant, Helldivers 2, Rocket League"
  | "Plat 2, -, Diamond" | "820, 60, 300" | "competitive, ranked-grind"
  | "Mon 19:00-23:00; Wed 19:00-23:00; Sat 13:00-02:00"
  | "NA-East Ranked Push" | Valorant | "PC" | NA-East | 5
  | "adhduy, rita, cesko" | "mic required, Gold-Diamond, 18+"
  | "queue in 5" | 2026-09-16 23:41
```

Everything wrong with this row is a normal form violation.

### 4.1 First normal form (1NF) — eliminate repeating groups

**1NF requires every attribute to be atomic:** no lists inside a cell, no
repeating groups of columns.

Seven attributes violate it: `platforms_owned`, `games_played`, `ranks`,
`hours`, `playstyle_tags`, `availability`, `group_platforms` and
`group_members` are all comma-delimited lists. Worse, `games_played`, `ranks`
and `hours` are _parallel_ lists — the second rank belongs to the second game
only by position, an association the database cannot enforce and a single
careless edit destroys.

The practical damage is immediate: you cannot index `"Valorant, Helldivers 2,
Rocket League"`, so "find everyone who plays Valorant" becomes
`LIKE '%Valorant%'` — a full scan that also matches a game called
`"Not Valorant"`. You cannot constrain a rank to 1–10 inside a string. And the
central query of this product, availability overlap, is not expressible at all
against `"Mon 19:00-23:00; Wed 19:00-23:00"`.

Decomposing into one row per fact:

- `user_platform(user_id, platform_id)`
- `user_game(user_id, game_id, self_rank, rank_tier, hours_played, goal, is_primary)`
  — note the parallel lists collapse into one row carrying game **with** its
  rank and hours, which is what made them parallel in the first place
- `user_tag(user_id, tag_id)`
- `availability_slot(slot_id, user_id, day_of_week, start_minute, end_minute)`
- `group_platform(group_id, platform_id)`
- `group_member(group_id, user_id, role, state, joined_at, left_at)`

Each is now atomic, indexable and constrainable.

### 4.2 Second normal form (2NF) — remove partial dependencies

**2NF requires 1NF plus: every non-key attribute depends on the _whole_
candidate key, not part of it.** This only bites on composite keys.

After 1NF, `user_game` has the composite key `(user_id, game_id)`. Suppose we
had carried the game's own attributes along, as the spreadsheet does:

```
USER_GAME(user_id, game_id, self_rank, hours_played,
          game_title, game_release_date, game_cover_url, game_metacritic)
```

The functional dependencies are:

```
(user_id, game_id) → self_rank, hours_played, goal, is_primary
         game_id   → game_title, game_release_date, game_cover_url, game_metacritic
```

The second line is a **partial dependency**: `game_title` depends on `game_id`
alone, which is only _part_ of the key. The consequences are the classic
anomalies:

- **Update anomaly.** Valorant's cover art changes. With 40,000 players holding
  it in their library, the title and cover are stored 40,000 times and every
  copy must be updated together, or the catalog disagrees with itself.
- **Insertion anomaly.** A game nobody plays yet cannot be recorded at all —
  there is no `user_id` to complete the key. The ETL loads 20,000+ games before
  a single user exists, so this is not hypothetical.
- **Deletion anomaly.** The last player removes Elden Ring from their library
  and the game's title, release date and cover vanish from the database.

The fix is to project the game-determined attributes into their own relation
keyed on `game_id` alone:

- `game(game_id, title, slug, release_date, cover_url, metacritic, …)`
- `user_game(user_id, game_id, self_rank, rank_tier, hours_played, goal, is_primary)`

The same reasoning applies to `group_member`: `display_name` depends on
`user_id` alone, not on `(group_id, user_id)`, so it stays in `profile`.

### 4.3 Third normal form (3NF) — remove transitive dependencies

**3NF requires 2NF plus: no non-key attribute depends on another non-key
attribute.** The spreadsheet has several.

**Case 1 — region.** The sheet carries both `region_code` and `region_name`:

```
user_id → region_code → region_name
```

`region_name` depends on `user_id` only _through_ `region_code`: a transitive
dependency. Storing both means "North America East" is repeated on every user
row, and a rename requires touching every one. Resolve by projecting the
dependent attribute into a relation keyed on the determinant:

- `region(region_id, code, name)`
- `profile(user_id, …, region_id)` — carrying only the foreign key

**Case 2 — group game.** `group_title → group_game → game_cover_url`. Same
shape, same fix: `lfg_group` holds `game_id` and nothing else about the game.

**Case 3 — group requirements.** `"mic required, Gold-Diamond, 18+"` is both a
1NF violation (a list) and a transitive dependency on `group_id`. It decomposes
into typed, constrained columns on `lfg_group`: `mic_required BOOLEAN`,
`min_age TINYINT`, `rank_floor`/`rank_ceiling` with
`CHECK (rank_floor <= rank_ceiling)`. A requirement the database can _check_ is
worth more than a requirement the database can only _store_.

**Case 4 — the interesting one, and why it stays.** Consider:

```
user_id → timezone → (UTC offset on a given date)
```

The UTC offset is transitively dependent on `timezone`, so a naive reading says
store the offset in a lookup table. We deliberately do **not**: the offset is
not a function of the timezone alone but of the timezone _and the instant_
(daylight saving), so the "dependency" is not functional at all. Storing it
would be storing a value that is wrong for half the year. Instead the offset is
computed at write time by the timezone conversion in `@faze/shared`, and only
the resolved UTC minutes are stored. This is a case where recognising that a
dependency is _not_ functional is what keeps the design correct.

### 4.4 The resulting relations, and BCNF

After decomposition, every relation is in 3NF. Checking the stronger condition:
in each relation, every determinant is a candidate key, so the schema is also
in **Boyce–Codd normal form**. The join tables are trivially in BCNF (all
attributes are prime). `profile`'s only determinant is `user_id`, its primary
key. `game` is determined by `game_id`, and each of `slug`, `steam_appid`,
`rawg_id` and `igdb_id` is a candidate key in its own right, declared `UNIQUE`
so the database enforces what the design asserts.

One relation warrants an explicit note. In `availability_slot`,
`uq_availability_slot_user_day_start (user_id, day_of_week, start_minute)`
makes that triple a candidate key alongside the surrogate `slot_id`. `end_minute`
depends on it fully, so BCNF holds; the surrogate exists only so that a single
slot can be addressed by one short key.

**The exception is `lfg_group.member_count`, which is a knowing violation.**
`member_count` is functionally determined by `group_id` through the _contents_
of `group_member`, so its presence is redundancy by definition. It is defended
in §6 rather than excused.

---

## 5. Two design decisions worth defending

### 5.1 Availability as UTC minutes-from-midnight

`availability_slot` stores `day_of_week` (0–6) plus integer `start_minute` and
`end_minute` in the range 0–1440, in UTC. The alternatives were `TIME` columns
in the user's local zone, or a `DATETIME` range per week.

The match score awards up to 15 points for overlapping availability, scaled by
overlapping minutes. With comparable integers, the overlap of two intervals is
pure arithmetic, and the total across every candidate is a single aggregate:

```sql
SUM(GREATEST(0, LEAST(a.end_minute, b.end_minute)
              - GREATEST(a.start_minute, b.start_minute)))
```

Stored as local `TIME` values, the same computation would require converting
every candidate's slots into a common zone _inside the query_, which MySQL
cannot do without knowing each user's zone — so it would move into application
code, fetch thousands of rows to score twenty, and become anti-pattern C1.

The cost is that conversion happens at write time and must be exactly right. A
slot crossing midnight UTC is split into two rows so every stored row satisfies
`end_minute > start_minute`, and the round trip reconstructs the original local
range on read. That conversion lives in exactly one tested function in
`@faze/shared` (AGENT 05), covering a 22:00–02:00 slot, `Asia/Tokyo`,
`America/Los_Angeles` across a DST boundary, and adjacent slots that should
merge.

### 5.2 `JSON` for provenance, never for logic

`game.raw_payload` and `audit_log.old_values`/`new_values` are `JSON` columns
(zyBooks Ch. 8). Keeping the original upstream response means a later ETL run
can extract a field nobody thought to normalize today, and the audit trigger
can record a full before/after row without a column per audited field.

The discipline that makes this justified rather than lazy: **nothing in the
application ever reads business logic out of these columns.** A `JSON` column
is not indexable the way a typed column is, and querying rules out of one would
quietly undo the normalization above. Anything the application branches on gets
a real column, with a real type and a real constraint.

---

## 6. The one deliberate denormalization

`lfg_group.member_count` duplicates `COUNT(*) FROM group_member WHERE
group_id = ? AND state = 'active'`.

**Why it exists.** The browse and matchmaking queries filter and score on open
slots for _every_ candidate group. Computing that aggregate per candidate on
the hot path turns an index range scan over `idx_lfg_group_recruit` into an
aggregate over hundreds of thousands of membership rows, on the single query
that defines the product.

**What we pay, deliberately.** Redundancy is only defensible if you also build
the thing that keeps it honest:

1. **Triggers are the only writers.** `trg_group_member_ai/au/ad` maintain
   `member_count` and flip `status` between `recruiting` and `full`.
   Application code writing this column is a review rejection (anti-pattern
   C3), and `GET`-side code only ever reads it.
2. **A reconciliation view.** `v_member_count_reconciliation` exposes
   `group_id`, the stored count, the true count, and their `drift`. It must
   always return zero rows with non-zero drift. The admin data-health panel
   renders it, so the invariant is visible rather than assumed.
3. **A fuzz test.** AGENT 15 performs 100 randomized join/leave/remove
   operations and asserts the drift is still zero.

**Why a trigger rather than the application.** The invariant must hold for
_every_ writer, including a stored procedure, a seed script, an admin action
and a future endpoint nobody has written yet. Application code can only
guarantee it for the paths that remember to. Putting the rule where the data
is means it cannot be bypassed.

`last_activity_at` is a second, smaller instance of the same pattern, written
by `trg_message_ai` for the +3 recency component.

---

## 7. Transactions and locking

The pool (`server/src/db/pool.ts`) exposes `withTransaction(fn)`, which BEGINs,
passes the connection, COMMITs, and ROLLBACKs on any throw, releasing the
connection on both paths. **Rule R9: every write touching more than one table
goes through it, or through a stored procedure that opens its own
transaction.** There are no exceptions.

MySQL's default isolation level is **REPEATABLE READ**, and it is left there.
That matters for the last-slot race in `sp_join_group`: under REPEATABLE READ a
plain `SELECT` returns a consistent snapshot from the start of the transaction,
so two concurrent joins would _both_ read `member_count = 4` against
`max_members = 5`, both conclude there is room, and both insert. The snapshot
is consistent and the outcome is still wrong — a check-then-act race
(anti-pattern C4).

`SELECT … FOR UPDATE` is therefore required, not optional. It takes an
exclusive row lock on the group, forcing the second transaction to wait until
the first commits and then read the _committed_ value (6 slots taken, in this
example), at which point its capacity re-check fails and it returns `'FULL'`.
Exactly one join succeeds. The full procedure, and the concurrency proof, are
in `0008_procedures.sql` and APPENDIX A-03.

---

## 8. Migrations

Schema changes are numbered SQL files under `db/migrations/`, applied by
`db/scripts/migrate.js`. Rules:

- Sequential 4-digit prefix. Never reused, never reordered.
- Every migration is idempotent (`CREATE TABLE IF NOT EXISTS`,
  `INSERT … ON DUPLICATE KEY UPDATE`, guarded `ALTER`s). This is load-bearing:
  MySQL commits implicitly on DDL, so a migration that fails halfway cannot be
  fully rolled back by a transaction — idempotency is what makes the retry safe.
- Every migration ships a paired `NNNN_*.down.sql`, dropping children first.
- `schema_migrations(filename, checksum, applied_at)` records what was applied.
  The runner **refuses to start** if an applied file's sha256 changed
  (anti-pattern C13): an applied migration is history, and other databases have
  already run the old version. The fix is a new corrective migration.

| Command               | Effect                                                 |
| --------------------- | ------------------------------------------------------ |
| `npm run db:migrate`  | Apply pending migrations in order                      |
| `npm run db:status`   | Print applied vs pending; no writes                    |
| `npm run db:rollback` | Run the newest `.down.sql` (refuses in production)     |
| `npm run db:reset`    | Drop → create → migrate → seed (refuses in production) |

---

## 9. Database programming

**Owner:** Bryan · **Source of truth:** `db/migrations/0007`–`0010`,
verified by `db/scripts/verify_objects.js`

This is where a database course's grade separates from a CRUD app: the
Express layer is a thin caller (routes → controllers → services →
repositories, and a repository's job for a multi-table write is `CALL sp_x`,
never a hand-rolled sequence of INSERTs). Every view, procedure and trigger
below exists because it protects an invariant or serves a query shape that
would otherwise be reimplemented — and drift — across multiple call sites.

### 9.1 Views (`0007_views.sql`)

| View                            | Purpose                                                                                                                                                                                                                                                            | Invariant it protects / query it serves                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v_group_card`                  | The shape `GET /api/groups`, browse cards, and every group-summary UI element read. One row per group with the game title/cover, owner display name, region code, a `GROUP_CONCAT`'d platform list, and `open_slots` computed once (`max_members - member_count`). | Nobody recomputes "open slots" differently in two places.                                                                                                                                                                                                                                                        |
| `v_user_profile_full`           | The shape `GET /api/auth/me` and `GET /api/profile/:name` read: one profile row with region/language names resolved and platform/tag lists collapsed.                                                                                                              | The `is_primary` lookup rule (§9.3) is expressed once, here, not reimplemented per caller.                                                                                                                                                                                                                       |
| `v_user_availability_minutes`   | A named, documented pass-through over `availability_slot` for the matchmaking overlap arithmetic.                                                                                                                                                                  | Exists so AGENT 07's query depends on a stable, documented surface rather than the base table directly.                                                                                                                                                                                                          |
| `v_group_activity`              | `messages_7d`, `joins_7d` and a computed `activity_score` (messages weighted 2×, since a message is a stronger "real people are here" signal than a join) for the +3 recency component of the match score.                                                         | Windowed at query time (`NOW() - INTERVAL 7 DAY`), not materialized — a materialized version would need its own daily-refresh trigger for a number nothing else depends on being exact to the second.                                                                                                            |
| `v_member_count_reconciliation` | `stored_member_count`, `actual_member_count`, and `drift` per group.                                                                                                                                                                                               | **The honesty check on the one deliberate denormalization in this schema** (§6). `drift` must be zero for every row, always — the admin data-health panel (AGENT 14) renders this view directly, and the AGENT 15 fuzz test asserts `WHERE drift <> 0` returns empty after 100 randomized membership operations. |
| `v_game_popularity`             | `active_group_count` and `searching_user_count` per multiplayer game, powering the onboarding "popular games" picker and a trending panel.                                                                                                                         | Filters to `is_multiplayer = 1` once, so a caller can never accidentally surface a single-player game as a trending multiplayer pick.                                                                                                                                                                            |

### 9.2 Stored procedures (`0008_procedures.sql`)

Every procedure declares `DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN
ROLLBACK; RESIGNAL; END;` immediately after its variable declarations. An
**unexpected** SQL error (a constraint violation, a deadlock) rolls back
everything the procedure had done and re-raises the original error unchanged
— partial writes are structurally impossible, not just avoided by
convention. An **expected, handled** outcome (a group being full, a user
already a member) is communicated through an `OUT` parameter after a normal
`COMMIT`, because refusing a join is a _successful_ call that correctly made
no change, not a database error.

| Procedure                  | Purpose                                                                                                                                                                                                                                           | Invariant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sp_create_group`          | Insert `lfg_group`, its `group_platform` rows (via `JSON_TABLE` over a CSV, set-based rather than a loop), and the owner's `group_member` row as one transaction.                                                                                 | Partial group creation is impossible — every other procedure and query assumes a group's owner is always also its first member. Proven: passing an out-of-domain platform id rolls back the `lfg_group` row too (§9.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `sp_join_group`            | Locks the group row, checks every hard requirement, and either inserts the membership or returns a refusal code.                                                                                                                                  | **The race-condition procedure** — see §9.5. Codes: `FULL`, `REQUIREMENT_MIC`, `REQUIREMENT_AGE`, `REQUIREMENT_RANK`, `ALREADY_MEMBER`, `REMOVED_PREVIOUSLY`, `NEEDS_REQUEST`, `NOT_FOUND`, `JOINED`. `REQUIREMENT_MIC` is a deliberate addition beyond the master prompt's literal six-code list: the task's own sentence names mic as a hard requirement to check, and the six required codes (`FULL`, `REQUIREMENT_AGE`, `REQUIREMENT_RANK`, `ALREADY_MEMBER`, `REMOVED_PREVIOUSLY`, `NEEDS_REQUEST`) are all still present and used exactly as specified. An **unranked** user (no `user_game` row, or `rank_tier IS NULL`) is never excluded by the rank check — the same rule AGENT 07 applies to the match score, for the same reason: excluding a beginner for not having ranked yet would be the product working against itself. |
| `sp_decide_join_request`   | Authorizes the decider (must be an active owner/moderator), updates `join_request`, and on approval inserts the member — one transaction, with a capacity re-check under lock (the group could have filled between the request and the decision). | An approval can never be recorded without the member actually being added, and a race between two moderators deciding the same request resolves to exactly one outcome.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `sp_leave_group`           | Sets `state='left'`; if the leaver was the owner, promotes the longest-tenured active moderator, else the longest-tenured active member, else archives the group.                                                                                 | **A group must never end up with zero owners while it still has active members.** Proven for all three branches: a moderator present, only plain members present, and the leaver being the sole member (§9.6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `sp_record_session_played` | Marks a session `played`, bumps `lfg_group.last_activity_at`, and returns the eligible rater/ratee pairs as a result set.                                                                                                                         | Does **not** pre-insert empty `rating` rows — `rating.score` is `NOT NULL`, so there is no valid "open, unscored" row this schema can represent (inventing one would be R3-violating placeholder data). Instead it flips the session to `played`, which `trg_rating_bi` (§9.3) requires before accepting any rating for that session — that state flip _is_ what "opens" the rating window.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `sp_set_primary_game`      | Demotes any existing primary game for a user, then promotes the requested one — one transaction, both-or-neither.                                                                                                                                 | **Not one of the five procedures the master prompt names.** It exists because `trg_user_game_bi`/`bu`, as literally specified, are impossible in MySQL — see §9.3's note.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 9.3 Triggers (`0009_triggers.sql`)

| Trigger                               | Fires on                                   | Purpose                                                                                                                                                                 | Invariant                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trg_group_member_ai` / `_au` / `_ad` | INSERT / UPDATE / DELETE on `group_member` | The **only** writers of `lfg_group.member_count`; also flip `status` between `recruiting` and `full` at capacity.                                                       | The other half of the deliberate `member_count` denormalization (§6) — this is what keeps the redundant column honest, for every writer, forever. Application code writing `member_count` directly is a defect (anti-pattern C3) precisely because these triggers already do it correctly. The status flip is deliberately narrow: it only ever moves a group between `recruiting` and `full`, never touching `active` or `archived`. |
| `trg_message_ai`                      | INSERT on `message`                        | Bumps `lfg_group.last_activity_at`.                                                                                                                                     | The data source for the +3 "recent activity" match-score component (§5.4) and the browse sort's tiebreaker — must be written by every message, from any future endpoint, without that endpoint needing to remember.                                                                                                                                                                                                                   |
| `trg_user_bu`                         | BEFORE UPDATE on `user`                    | Writes an `audit_log` row when `status` changes.                                                                                                                        | Fires only on an actual status change (not every unrelated update), so the log stays a real trail, not noise. `actor_user_id` is `NULL` — a trigger has no notion of "who is making this HTTP request"; recording `NULL` is honest, guessing would not be.                                                                                                                                                                            |
| `trg_profile_bu`                      | BEFORE UPDATE on `profile`                 | Writes an `audit_log` row when `display_name` changes.                                                                                                                  | Same reasoning as `trg_user_bu`, for the account attribute an impersonation investigation would need history for.                                                                                                                                                                                                                                                                                                                     |
| `trg_rating_bi`                       | BEFORE INSERT on `rating`                  | Rejects a rating (`SIGNAL SQLSTATE '45000'`) unless (a) the session is `state = 'played'` **and** (b) both rater and ratee were active members of that session's group. | **The single source of rating eligibility** (AGENT 06 delegates this check here rather than reimplementing it in the route). Condition (a) is a deliberate addition beyond the task's literal sentence — without it, a rating could exist for a session that has not happened yet. Neither condition is expressible as a `CHECK` constraint, because both require reading other tables.                                               |

**`trg_user_game_bi` / `trg_user_game_bu` do not exist.** The master prompt
names them: "enforce at most one `is_primary = 1` per user by demoting the
previous primary." This is impossible to implement literally — confirmed
empirically, not assumed:

```
ERROR 1442 (HY000): Can't update table 'user_game' in stored function/trigger
because it is already used by statement which invoked this stored
function/trigger.
```

MySQL categorically forbids a trigger from issuing `UPDATE`/`DELETE` against
the _same table_ its firing statement is already writing to, even for a
different row, and even for a plain single-row `INSERT` with no `ON
DUPLICATE KEY UPDATE` involved. There is no `BEFORE`/`AFTER` timing trick
around it.

The invariant is enforced **structurally** instead, which is arguably
stronger than a trigger would have been: `user_game.primary_owner_id`
mirrors `user_id` exactly when `is_primary = 1` and is `NULL` otherwise, and
`uq_user_game_one_primary_per_user` — a `UNIQUE` index on that column — makes
a second `is_primary = 1` row for the same user structurally impossible for
_every_ writer: a stored procedure, a future endpoint, a raw SQL statement in
a bug, not just the ones that remembered to call a trigger-equivalent helper.

It is a **plain** column, not a `GENERATED ALWAYS AS (...) STORED` one, for a
second, independently confirmed MySQL limitation: adding a `UNIQUE` index
over a generated `STORED` column to a table with two or more foreign keys
fails with a misleading `ERROR 1215 (HY000): Cannot add foreign key
constraint`, reproduced on a throwaway table with the identical FK shape as
`user_game` (FKs to `user` and `game`), regardless of statement order or
`foreign_key_checks`. `user_game` has exactly two FKs, so the generated-column
form is unavailable here. A plain column gives the identical guarantee via
the index; the only difference is that something has to _write_ it —
`sp_set_primary_game` (§9.2), the one sanctioned way to change a user's
primary game.

### 9.4 Indexes (`0010_indexes_initial.sql`)

All seven indexes this agent's task list names **already existed**, created
ahead of time in AGENT 01 (0003–0005) while designing the schema around the
access patterns these features would need. `0010` does not duplicate them —
doing so would create a genuine redundant index (the optimizer would never
choose it over the original, and it would cost every future write a second
index-maintenance operation for zero read benefit — precisely the class of
defect AGENT 16 is tasked with finding and removing). Instead `0010`
documents the reconciliation, and `verify_objects.js` checks column coverage
against the real index names rather than requiring an exact name match:

| Requested                                                      | Real index (exact match unless noted)                                | Serves                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `idx_group_recruit(game_id,status,region_id,last_activity_at)` | `idx_lfg_group_recruit`                                              | The browse/matchmaking filter.                                   |
| `idx_group_owner(owner_user_id)`                               | `idx_lfg_group_owner`                                                | "Groups I own"; the 10-recruiting-groups cap.                    |
| `idx_member_user_state(user_id,state)`                         | `idx_group_member_user_state`                                        | `GET /api/me/groups`.                                            |
| `idx_user_game_game(game_id,rank_tier)`                        | `idx_user_game_game_rank`                                            | Candidates + rank-window checks in `sp_join_group`.              |
| `idx_avail_user_day(user_id,day_of_week)`                      | `idx_availability_slot_user_day` — **superset**, adds `start_minute` | Covering for the availability-overlap join's ordering.           |
| `idx_message_group_time(group_id,created_at)`                  | `idx_message_group_time` — **superset**, adds `message_id`           | Backwards keyset message paging resolvable from the index alone. |
| `idx_join_request_group_state(group_id,state)`                 | `idx_join_request_group_state`                                       | The owner's pending-request queue.                               |

One index was added after the initial set: migration `0012` adds
`idx_availability_slot_day_time (day_of_week, start_minute, end_minute, user_id)`
for the match query's availability-overlap step. It cut that step from 160 ms to
45 ms and the whole query from 295 ms to 164 ms on 20,000 users and 5,000
groups; the `EXPLAIN` evidence is in [`performance.md`](performance.md).

### 9.5 Transaction isolation, and why `sp_join_group` still needs `FOR UPDATE`

The connection pool (`server/src/db/pool.ts`) and every procedure here run
under MySQL's default isolation level, **REPEATABLE READ**, left at the
default deliberately rather than weakened for throughput. Under REPEATABLE
READ, a plain `SELECT` inside a transaction returns a consistent snapshot
taken at the start of that transaction — reads are repeatable, which is
exactly the guarantee most of this schema's read paths want.

It is _not_, on its own, enough to make `sp_join_group`'s capacity check
correct. Consider two users joining the last slot of a 5/5-capacity group at
the same instant, with a naive `SELECT member_count ... ` (no lock):

1. Both transactions begin and each takes its own REPEATABLE READ snapshot.
2. Both read `member_count = 4`, `max_members = 5` — room for one more.
3. Both conclude the join is allowed and both `INSERT`.
4. Both commit. `member_count` becomes 6 (or the group silently has 6
   members before the trigger even runs) — a **check-then-act race**
   (anti-pattern C4). Snapshot consistency did not prevent this: each
   transaction's snapshot was individually consistent and _still_ wrong once
   both committed.

`SELECT max_members, member_count, ... FROM lfg_group WHERE group_id = ? FOR
UPDATE` changes this by taking an **exclusive row lock**, not a snapshot
read. The second transaction's `FOR UPDATE` blocks — it does not proceed
past that `SELECT` at all — until the first transaction commits or rolls
back. Once unblocked, it reads the row **as it now exists**, post-commit,
not the snapshot from when its own transaction began. This is what makes the
capacity check see the true, current `member_count` rather than a stale one,
and it is why exactly one of eight concurrent `sp_join_group` calls for a
single open slot succeeds (proven in APPENDIX A-03, not merely asserted:
three repeated runs, each producing exactly 1 `JOINED` and 7 `FULL`).

The same reasoning is why `sp_leave_group` locks the group row before
deciding succession (a concurrent leave and join must not interleave into an
inconsistent owner state), and why `sp_decide_join_request` re-locks and
re-checks capacity before approving — the group could have filled in the
time between the request being made and a moderator deciding it.

`SELECT ... FOR UPDATE` is therefore not a performance tax paid out of
caution; it is the specific mechanism that makes REPEATABLE READ's snapshot
isolation compatible with a check-then-act decision at all. A procedure that
reads a value with a plain `SELECT` and later writes based on it is not
safe under any transaction isolation level up to (and, for some write
patterns, including) REPEATABLE READ without an explicit lock — this is the
concrete illustration of that principle the codebase actually needed.
