# Normalisation in plain English

**Normalising** means arranging data so each fact is stored **once, in the one
place it belongs**. That prevents the database from contradicting itself. This
page shows how FAZE gets there, starting from the spreadsheet most people would
build first. The full version, with every dependency written out, is in
[`schema.md`](schema.md) §4.

## The starting point: one big spreadsheet

One row per person looking for a group, with everything about them and their
group side by side:

| email   | platforms  | games                   | ranks           | region_code | region_name        | group_game | game_cover   |
| ------- | ---------- | ----------------------- | --------------- | ----------- | ------------------ | ---------- | ------------ |
| a@x.com | PC, Switch | Valorant, Rocket League | Plat 2, Diamond | NA-East     | North America East | Valorant   | valorant.jpg |

## Step 1 — First normal form (1NF): one value per cell

**Rule:** no lists inside a cell.

**Problem here:** `platforms`, `games` and `ranks` are lists. You cannot index
them, "who plays Valorant?" turns into a slow text search, and the rank
"belongs" to the second game only because of its _position_ in the list — one
careless edit breaks it.

**Fix:** one row per fact.

| Before                                    | After                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `platforms = "PC, Switch"`                | `user_platform`: two rows, `(user, PC)` and `(user, Switch)`                              |
| `games` + `ranks` as parallel lists       | `user_game(user_id, game_id, rank_tier, …)`: each game carries its own rank               |
| `availability = "Mon 19:00-23:00; Wed …"` | `availability_slot`: one row per slot, as UTC minutes, so overlaps can be computed in SQL |

## Step 2 — Second normal form (2NF): no half-dependencies

**Rule:** when a table's key has several columns, every other column must depend
on **all** of them.

**Problem here:** if `user_game` also held `game_title` and `game_cover`, those
depend on `game_id` alone, not on the pair `(user_id, game_id)`. Then a
game's cover is copied once per player. Change it and you must update thousands
of copies. A game nobody plays could not be stored at all. And when the last
player removes a game, its title would vanish.

**Fix:** a `game` table keyed by `game_id` holds title and cover once.
`user_game` keeps only what is about _this person and this game_: rank, hours
and goal.

## Step 3 — Third normal form (3NF): no chains

**Rule:** a column must depend on the key, not on another non-key column.

**Problem here:** `user → region_code → region_name`. The name depends on the
code, so "North America East" is repeated on every user in that region, and a
rename means editing every row.

**Fix:** a `region(region_id, code, name)` table; the profile stores only
`region_id`. The same idea gives `lfg_group.game_id` instead of a copy of the
game's details, and typed columns (`mic_required`, `min_age`, `rank_floor`,
`rank_ceiling`) instead of the text "mic required, Gold-Diamond, 18+".

## A rule we deliberately did not apply

A user's time zone and its UTC offset look like another chain. But the offset
depends on the _date_ too (daylight saving), so it is **not** a fixed fact about
the time zone. Storing it would be wrong for half the year. We convert to UTC
when saving and store only the result.

## The one deliberate exception

`lfg_group.member_count` repeats something the database could count from
`group_member`. We keep it on purpose, because the match and browse queries read
it for every group and counting each time would be slow. Triggers are the only
thing allowed to change it, and the view `v_member_count_reconciliation` shows
any drift (it must always be empty). See [`schema.md`](schema.md) §6.

## Result

Every table is in 3NF, and in Boyce–Codd normal form too: wherever one column
decides another, it is a declared key (`UNIQUE` or primary). The database
enforces what the design claims.
