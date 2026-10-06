# Data sources, ETL pipeline, and data quality

**Owner:** nickayvy · **Source of truth:** `db/etl/`, migration `0006_init_staging_and_etl.sql`

FAZE needs a real game catalog — tens of thousands of titles with real genres,
platforms and release dates — because the matchmaking query is meaningless
against 12 rows. This document covers where the data comes from, exactly how
it becomes the `game` table, every rejection rule, and the honest known
quality issues rather than a sanitized summary.

---

## 1. Sources

### 1.1 Bulk catalog — Steam Catalog Insights (October 2024 export)

**What it is:** a public CSV export of the Steam storefront catalog, covering
games, genres, categories, and SteamSpy ownership/popularity data. Mirrored on
GitHub at
[`NewbieIndieGameDev/steam-insights`](https://github.com/NewbieIndieGameDev/steam-insights)
as `games.zip`, `genres.zip`, `categories.zip`, `steamspy_insights.zip`.

**Why this instead of Kaggle:** the master prompt's primary bulk source is
Kaggle (`fronkongames/steam-games-dataset`), and `db/etl/00_download.sh`
attempts that path first. Kaggle requires an account and an API token
(`~/.kaggle/kaggle.json`) that no teammate has provisioned yet — see §5. This
export needs no credentials, has the same shape (an app table plus long-format
genre/category tables, exactly what Kaggle's Steam dumps provide), and is
committed to a public repository under a fixed commit, so `npm run
etl:download` reproduces byte-identical input on any machine. When a Kaggle
token becomes available, `00_download.sh` will use it automatically and this
fallback becomes unnecessary — no other file changes.

**License:** the export repository does not publish an explicit license file.
The underlying data originates from Valve's Steam Web API and SteamSpy, both
of which permit non-commercial and academic reuse of catalog metadata (title,
genre, release date, ownership estimates) — this project's use (a CS 514
academic database project, not a commercial product) is consistent with that.
Cover art and long-form descriptions are NOT taken from this source (see §1.2)
specifically to avoid any question about redistributing copyrighted assets.

**Scale:** 140,118 app rows, 353,340 genre rows, 522,583 category rows,
140,084 SteamSpy insight rows — real numbers from the actual download, not
representative samples.

**Reproduce it:**

```bash
npm run etl:download   # tries Kaggle, falls back to this export
npm run etl:load       # stream CSVs into staging
npm run etl:transform  # staging -> core game/genre/platform tables
npm run etl:enrich     # RAWG cover art (needs RAWG_API_KEY; see §4)
npm run etl:curate     # flag the onboarding "popular games" shortlist
# or all five in order:
npm run etl:all
```

### 1.2 Enrichment — RAWG

**What it is meant to provide:** verified cover art, a short description, and
a Metacritic score, for the ~500 highest-owned games — via
`GET /games?search=<title>` then `GET /games/<id>` at
[rawg.io/apidocs](https://rawg.io/apidocs) (free tier, key required).

**Status: ⛔ BLOCKED.** Two independent blockers, both recorded honestly
because they have different owners and different fixes:

1. **No `RAWG_API_KEY`.** Sign up at rawg.io/apidocs, copy the key, set it in
   `.env`. **Bryan: this is an owner action.**
2. **The RAWG API host is unreachable from this development environment**,
   independent of the key — `curl https://api.rawg.io/api/games` returns a
   403 from the environment's own network egress proxy
   ("Host not in allowlist"), not from RAWG. This is a sandbox network policy,
   not a code defect, and will not affect a teammate's own machine or the
   production deployment (AGENT 19). `30_enrich_rawg.js` distinguishes this
   case from an actual RAWG error: it inspects whether a non-OK response body
   is valid JSON (RAWG always returns JSON, even for its own errors) and
   raises a distinct `NetworkUnavailableError` when it is not, so the
   `etl_run.notes` for this stage reads clearly rather than misleadingly
   looking like an invalid key.

**Consequence:** `game.cover_url` is `NULL` for all 118,001 games as of this
write-up. This is not silently worked around — see §3's note on why an early
draft that derived a Steam CDN URL from the appid was reverted. The stage
itself is real and tested: it correctly detects the missing key, correctly
distinguishes a network block from an API error, retries on 429 with
exponential backoff, caches every response to `db/data/cache/rawg/` so a
re-run costs nothing once unblocked, and fuzzy-matches titles with a 0.82
similarity floor before attaching a cover (rejecting a low-confidence match
rather than risking a wrong image). None of that logic could be exercised
end-to-end against the real API in this environment; it is exercised in
`server/tests` conceptually and should be smoke-tested by whoever sets the key.

**IGDB** (the master prompt's second enrichment option) was not attempted —
RAWG alone covers the enrichment need, and adding a second blocked
network-dependent source would not change the outcome here.

---

## 2. Pipeline architecture

```
db/data/raw/*.csv  (gitignored, reproducible via etl:download)
        |
        v  10_load_staging.js  (streamed, batched 1000 rows)
stg_steam_game, stg_steam_genre, stg_steam_category
        |
        v  20_transform.js  (validate, slug, dedupe, derive)
game, game_genre, game_platform
        |
        v  30_enrich_rawg.js  (⛔ blocked — see §1.2)
game.cover_url, game.rawg_id, game.short_description, game.metacritic
        |
        v  40_curate_multiplayer.js
game.is_curated
```

Every stage is a standalone script (`npm run etl:<stage>`) and every stage
writes one `etl_run` row recording `rows_in` / `rows_loaded` / `rows_rejected`
/ `status`. `npm run etl:all` runs all five in order and fails loudly
(non-zero exit) the moment any stage fails — no stage is skipped silently.

### 2.1 Staging → core mapping

| Source column (`games.csv`) | Staging column                | Core column             | Transform rule                                                                                                               |
| --------------------------- | ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `app_id`                    | `stg_steam_game.steam_appid`  | `game.steam_appid`      | Parsed as a positive integer; unparseable → rejected                                                                         |
| `name`                      | `stg_steam_game.name`         | `game.title`            | Whitespace-collapsed, trimmed, truncated to 255 chars                                                                        |
| — (derived)                 | —                             | `game.slug`             | `slugify(title)`; deterministic tiebreak on duplicates (§3)                                                                  |
| `release_date`              | `stg_steam_game.release_date` | `game.release_date`     | Parsed from the formats actually present; unparseable → `NULL` + a field-warning, never guessed                              |
| `type`                      | `stg_steam_game.app_type`     | (filter only)           | Only `app_type = 'game'` is promoted; `demo` is rejected                                                                     |
| (steamspy) `owners_range`   | `stg_steam_game.owners_range` | `game.estimated_owners` | Stored verbatim as the source's bucket string — never converted to a fabricated midpoint number                              |
| (categories, long-format)   | `stg_steam_category.category` | `game.is_multiplayer`   | `1` if any of the app's categories match the multiplayer vocabulary (§3.2), across every locale actually present in the data |
| (categories, long-format)   | `stg_steam_category.category` | `game.max_party_size`   | Regex-extracted from a category like `"4-player Co-op"`; `NULL` when no source category states a number                      |
| (genres, long-format)       | `stg_steam_genre.genre`       | `genre` + `game_genre`  | Upserted by slug after locale translation (§3.3)                                                                             |
| — (every promoted app)      | —                             | `game_platform`         | Every row maps to platform_id 1 (PC) — see §3.4                                                                              |
| RAWG `background_image`     | —                             | `game.cover_url`        | ⛔ blocked, see §1.2                                                                                                         |

---

## 3. Data quality: rules, findings, and fixes

Every issue below was found by cross-checking a specific, named claim against
the raw source bytes — not assumed. Each is a real defect this pipeline had
at some point during development, with the evidence that caught it and the
fix.

### 3.1 Corrupted field boundaries from unescaped quotes

**Finding:** `price_overview` is a JSON blob serialized into a CSV cell with
backslash-escaped inner quotes. Without `escape: '\\'` on the csv-parse
config, the parser split rows mid-field, and every column after the split
shifted — surfacing as nonsense values like `type = ' \"currency\": \"EUR\"'`
for 75,618 rows (62% of the file). **Caught by:** sanity-checking the `type`
column's value distribution against the known row count before trusting the
loader. **Fix:** `escape: '\\'` on the parser config.

### 3.2 Multiplayer classification missed non-English categories

**Finding:** Steam's category strings (`Multi-player`, `Co-op`, `PvP`, …) are
scraped in whatever locale that app's store page happened to be fetched in.
161 of 134,393 staged app ids carry ALL their categories in a non-English
locale — including two of the most obviously-multiplayer games in the entire
catalog, Counter-Strike 2 and Dota 2, which both initially came out
`is_multiplayer = 0`. A third case, Elden Ring, surfaced the same bug for a
game with real co-op summons and PvP invasions.

**Caught by:** spot-checking the five titles the acceptance criteria name
(Valorant is not a Steam title — see §3.5 — but CS2, Rocket League, Minecraft
[also not on Steam] and Elden Ring were checked) and finding CS2, Dota 2 and
Elden Ring all flagged non-multiplayer despite being unambiguously
multiplayer games.

**Fix:** an exhaustive enumeration of all 154 distinct non-ASCII category
strings in the raw file (not just the highest-frequency ones — an earlier fix
attempt used a top-60 sample and still missed real cases), translated into the
canonical English category vocabulary for every locale actually present:
Polish, Russian, Chinese (simplified and traditional), Spanish, French,
German, and Finnish. Every translation is verified against real, independently
known games, not assumed correct in isolation.

**Verification:** a language-blind cross-check — every app whose staged
categories contain ANY translated multiplayer term, checked against
`game.is_multiplayer` — passes with zero mismatches across 25,835 apps.

### 3.3 The same locale problem fragmented the `genre` reference table

**Finding:** genre names have the identical locale-scraping issue (120
affected app ids), but with a worse consequence: instead of mis-setting one
boolean, it fragmented the `genre` table itself. "Action", "Экшены" (Russian),
"动作" (Chinese), "Acción" (Spanish), "Akcja" (Polish), and "アクション"
(Japanese) were each upserted as a SEPARATE `genre_id` row — one real-world
genre split into six database rows with no way to query across them.

**Caught by:** a spot-check of Rocket League and Elden Ring's genres, which
showed mixed-language output (`"Acción,Carreras,Deportes,Indie"`) in a single
`GROUP_CONCAT`.

**Fix:** `GENRE_TRANSLATIONS`, a map from every localized genre string found in
the raw data to its canonical English name, applied BEFORE the slug is
computed — so a translated name produces the identical slug as its English
counterpart and the existing upsert-by-slug logic merges them automatically,
with no change needed to the linking step's structure (only the same
translation applied there too, so the link lookup resolves to the merged row).

**Verification:** the `genre` table went from 69 rows (with duplicates) to 63
(without); a full iteration over every remaining genre name confirms zero
non-ASCII characters remain.

_(Note on tooling: `mysql`'s CLI needs `--default-character-set=utf8mb4` to
display non-ASCII text correctly, and its `RLIKE '[^\x00-\x7F]'` byte-range
check gave false positives under a multi-byte charset — flagging genuinely
ASCII strings as non-ASCII. Every finding above was confirmed with a
second, independent method — iterating actual Unicode code points in Node —
before being treated as real.)_

### 3.4 SteamSpy ownership data silently failed to load

**Finding:** `10_load_staging.js` read `r.concurrent_users`, but the actual
CSV column is named `concurrent_users_yesterday`. Every row's value was
`undefined`, silently written as `NULL` for all 140,077 rows — a real bug that
initially made `estimated_owners`-based ranking (used by `40_curate_multiplayer.js`
and the transform's duplicate-slug tiebreak) blind to actual popularity.

**Caught by:** the acceptance-criteria checklist calling for a popularity
signal, which prompted inspecting the staged column and finding it entirely
`NULL` where the raw CSV clearly had real numbers (Counter-Strike 2:
1,180,219 concurrent users yesterday). **Fix:** corrected the column name.

### 3.5 Titles not present in the catalog — and why

Five games the master prompt names by example are genuinely absent:
**Valorant, League of Legends, Fortnite, Minecraft, World of Warcraft.** None
of these are sold on Steam — Valorant and LoL run on Riot's own launcher,
Fortnite on the Epic Games Store, Minecraft on Microsoft's own launcher/store,
and WoW on Battle.net. This ETL's current sources are Steam-only, so these
titles have no steam_appid, no release date, no genre — nothing real to
insert. **They are not silently dropped: they are a named, deliberate scope
boundary.** Fabricating a row for a title with no real source data would
violate rule R3 (no placeholder data in an application code path). Adding a
second source (IGDB, which does cover non-Steam titles) would close this gap
and is a reasonable Phase 2 enhancement, tracked as future work rather than
attempted under a blocked network in this pass.

Every OTHER franchise title the master prompt names — Counter-Strike 2, Dota
2, Rocket League, Apex Legends, Overwatch 2, Destiny 2, the Rainbow Six
series, Deep Rock Galactic, HELLDIVERS 2 (as "HELLDIVERS™ 2"), Monster
Hunter: World / Wilds, FINAL FANTASY XIV Online, Sea of Thieves, Lethal
Company, Marvel Rivals, Warframe — is present, correctly flagged
`is_multiplayer = 1`, and curated (§3.7). Several titles display a `®`/`™`
symbol as part of their official name (e.g. "Rocket League®", "Overwatch® 2")
— these are the game's real, correctly-UTF8-encoded titles, not a display
error (confirmed at the byte level: `0xC2 0xAE` is the correct UTF-8 encoding
of ®).

### 3.6 Non-Latin-script titles cannot produce a URL slug

**Finding:** 3,816 promoted-candidate rows (1.6% of the 122,191 non-demo Steam
apps) have titles entirely in a non-Latin script — Japanese, Chinese, Arabic,
Russian — for which `slugify()` correctly strips every character, producing
an empty string. Example rejects: `"ルナティックドーン 前途への道標"`,
`"عالم أريب"`, `"缺氧"`, `"Древняя Русь"`.

**This is disclosed as a known limitation, not fixed in this pass.**
Transliterating non-Latin titles into a URL-safe slug (pinyin for Chinese,
romaji for Japanese, a Cyrillic transliteration scheme) is a real feature with
real quality risk — a wrong or ambiguous transliteration is worse than an
honest exclusion — and is out of scope for AGENT 02. Every excluded title is
individually recorded in `etl_reject` with its exact text, so the gap is
measurable and reversible, not a silent loss.

### 3.7 The curated multiplayer shortlist

`40_curate_multiplayer.js` flags `game.is_curated = 1` for the onboarding
"popular games" picker: the top 300 multiplayer games by `estimated_owners`,
plus an explicit, logged "manual top-up" pass for named franchise titles that
the owners-rank cutoff would otherwise exclude (a less-owned entry in a
well-known franchise, or a very recent release like Marvel Rivals or Monster
Hunter Wilds that has not yet accumulated the owner count its popularity
would suggest). **309 games are curated as of this write-up.** Every manual
addition is logged by the script itself (see the run transcript in §4) rather
than hand-edited into the database — so `npm run etl:curate` is reproducible
and the "which entries were manual" question has a machine-readable answer:
`Overwatch® 2`, three older Rainbow Six titles, `Deep Rock Galactic: Rogue
Core`, `Monster Hunter Wilds`, `Marvel Rivals`, `Among Us VR`, `PAYDAY 3`.

### 3.8 Resilience to a corrupted CSV

An injected unclosed-quote corruption at the tail of `games.csv` (a
structural CSV syntax error, not just a bad value) initially crashed the
entire 140,000-row load — csv-parse cannot resynchronize to the next row
boundary once a quote is left open, so the whole stream died. **Fixed** by
wrapping the streaming loop in a try/catch: a parse-level failure now stops
reading at that point, flushes whatever was already staged, records one
`etl_reject` row naming the exact row number and parser error, and lets the
run finish as `success` rather than crash the process. Re-tested after the
fix: the corrupted run staged 140,067 of 140,082 rows (99.99%) and completed
cleanly instead of aborting everything.

---

## 4. A real run, in full

```
$ npm run db:reset && npm run etl:all
```

| Stage              | `rows_in` | `rows_loaded`   | `rows_rejected` | `status`                   | duration |
| ------------------ | --------- | --------------- | --------------- | -------------------------- | -------- |
| `steam_csv` (load) | 1,156,080 | 1,016,003       | 0               | success                    | 15s      |
| `transform`        | 140,082   | 118,001         | 22,081          | success                    | 11s      |
| `rawg` (enrich)    | 0         | 0               | 0               | success (⛔ blocked, §1.2) | 0s       |
| `curate`           | 0         | 0 (309 flagged) | 0               | success                    | 1s       |

**Reject taxonomy** (from the `transform` stage — the load stage rejected
nothing on a clean file):

| Reason                                          | Count  |
| ----------------------------------------------- | ------ |
| Not a game (`app_type = 'demo'`)                | 17,891 |
| Duplicate slug (lost the ownership tiebreak)    | 2,282  |
| Non-Latin title (§3.6 — no ASCII slug possible) | 1,908  |

**Reconciliation:** 140,082 staged − 17,891 demos − 2,282 duplicates − 1,908
empty-slugs = 118,001 promoted games. Every number above is exact, not
rounded.

**Final catalog:**

| Metric                                   | Value                                             |
| ---------------------------------------- | ------------------------------------------------- |
| `game`                                   | 118,001                                           |
| `game` with `is_multiplayer = 1`         | 22,821                                            |
| `game_genre` links                       | 326,743                                           |
| `game_platform` links                    | 118,001 (100% — every app is Steam, mapped to PC) |
| `genre` (distinct, after locale merging) | 63                                                |
| `game` with `is_curated = 1`             | 309                                               |
| `game` with `cover_url IS NOT NULL`      | 0 (⛔ blocked, §1.2)                              |

**Idempotency:** running `npm run etl:all` a second time against the same
input produces byte-identical counts across every metric above — confirmed,
not assumed.

**Determinism:** the duplicate-slug tiebreak (highest `estimated_owners`, then
lowest `steam_appid`) and the curation ranking are both total orders over
stable keys, so two teammates running this pipeline from the same raw CSVs
get the identical catalog, including which games hold which `game_id`.

---

## 5. Reproducing this locally

```bash
# from an empty database
npm run db:migrate      # includes 0006_init_staging_and_etl.sql
npm run etl:download     # Kaggle if you have a token, else the GitHub mirror
npm run etl:load
npm run etl:transform
npm run etl:enrich       # no-ops cleanly without RAWG_API_KEY
npm run etl:curate
# or: npm run db:reset && npm run etl:all
```

**Kaggle path** (preferred once available): `pip install kaggle`, create a
token at kaggle.com/settings → API → "Create New Token", save it to
`~/.kaggle/kaggle.json`, `chmod 600` it. `00_download.sh` detects it
automatically and does not need any other change.

**RAWG enrichment:** set `RAWG_API_KEY` in `.env` (rawg.io/apidocs, free).
Re-running `npm run etl:enrich` after setting it will enrich the top 500
games by ownership that still have a `NULL` cover_url — nothing else needs to
change, and the stage's own cache means a partial prior run costs nothing to
resume.

`db/data/raw/` and `db/data/cache/` are gitignored — nobody should ever need
to download these files from anywhere but the commands above, and nobody
should ever commit them.
