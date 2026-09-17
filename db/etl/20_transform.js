/**
 * ETL stage 20 — staging into the normalized core.
 *
 * This is where dirt becomes data. Every rule below exists because the source
 * actually violates it; none of them are defensive programming against
 * imagined problems.
 *
 * Promotion rules:
 *   - only `app_type = 'game'` is promoted. Demos and DLC are real rows in the
 *     source (17,891 demos) but nobody forms a group for a demo.
 *   - titles are whitespace-collapsed and slugged deterministically.
 *   - duplicate slugs are resolved with a fixed tiebreak — highest estimated
 *     owners wins, then lowest appid — so every machine produces the same
 *     catalog. A random or insertion-order tiebreak would make two teammates'
 *     databases disagree about which "Fall Guys" is game_id 412.
 *   - release dates are parsed from the formats the source uses; anything else
 *     becomes NULL with a logged finding. A guessed date is worse than no date.
 *   - genres are upserted by slug; categories drive is_multiplayer and
 *     max_party_size.
 *
 * Idempotent: keyed upserts on the natural key (steam_appid) throughout, so
 * re-running changes no row counts.
 */
import { runStage, slugify, cleanText } from './_etl_lib.js';

const BATCH = 1000;
/** Steam's NULL sentinel leaks into the CSV export as literal text. */
const NULL_SENTINELS = new Set(['\\N', '\\\\N', 'N', 'NULL', 'null', 'None', '']);

/**
 * Parses the release-date formats this source actually contains.
 * Returns a 'YYYY-MM-DD' string, or null when the value cannot be trusted.
 */
const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
function parseReleaseDate(raw) {
  const v = cleanText(raw);
  if (v === null || NULL_SENTINELS.has(v)) return null;

  // 2018-02-08
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) {
    const [, y, mo, d] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d));
    // Rejects 2018-02-30, which Date would silently roll into March.
    if (date.getUTCMonth() + 1 !== +mo || date.getUTCDate() !== +d) return null;
    return `${y}-${mo}-${d}`;
  }
  // 8 Feb, 2018  /  Feb 8, 2018
  m = /^(\d{1,2})\s+([A-Za-z]{3,})[,]?\s+(\d{4})$/.exec(v);
  if (!m) {
    const m2 = /^([A-Za-z]{3,})\s+(\d{1,2})[,]?\s+(\d{4})$/.exec(v);
    if (m2) m = [m2[0], m2[2], m2[1], m2[3]];
  }
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mo) return null;
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  }
  // "Q1 2019", "Coming soon", "To be announced" — a real release date is not
  // knowable from these, so they stay NULL rather than being invented.
  return null;
}

/**
 * Orders the SteamSpy owners bucket ("1,000,000 .. 2,000,000") for the dedup
 * tiebreak. Returns the bucket's lower bound. This value is used ONLY for
 * ordering — it is never stored as if it were a true owner count, because the
 * source publishes a range and precision we do not have is precision we must
 * not claim.
 */
function ownersLowerBound(raw) {
  const v = cleanText(raw);
  if (v === null || NULL_SENTINELS.has(v)) return 0;
  const first = v.split('..')[0].replace(/[^0-9]/g, '');
  const n = Number.parseInt(first, 10);
  return Number.isSafeInteger(n) ? n : 0;
}

/**
 * Categories that mean "people can play this together". Taken from the actual
 * category vocabulary in the data, not guessed:
 *   Multi-player 24,987 · PvP 15,315 · Co-op 14,054 · Online PvP 11,274 ·
 *   Online Co-op 8,952 · Shared/Split Screen 8,918 · Cross-Platform Multiplayer
 */
const MULTIPLAYER_CATEGORIES = new Set([
  'Multi-player',
  'PvP',
  'Online PvP',
  'Co-op',
  'Online Co-op',
  'Cross-Platform Multiplayer',
  'Shared/Split Screen',
  'Shared/Split Screen PvP',
  'Shared/Split Screen Co-op',
  'MMO',
  'Remote Play Together',
]);

/**
 * Extracts a party size from a category string such as "4-player Co-op".
 * Returns null when the text does not state one — never a made-up default.
 */
function partySizeFromCategory(category) {
  const m = /(\d{1,3})\s*-?\s*player/i.exec(category);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(n) && n >= 1 && n <= 100 ? n : null;
}

/**
 * Steam serves every app's header image from a deterministic CDN path keyed on
 * the appid. This is DERIVED, not fetched: we are constructing a well-known
 * URL from a real identifier, the same way `slug` is derived from `title`.
 *
 * It is explicitly NOT a claim that the image was verified to exist — doing
 * that needs a request per game to Steam's CDN. docs/data.md records this
 * distinction, and the RAWG enrichment stage replaces these with URLs that
 * came back from a real API response for the games it covers.
 */
function steamHeaderUrl(appId) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

await runStage('transform', async (conn, run) => {
  // ---------------------------------------------------------------------------
  // 1. Genres: upsert by slug, then build an in-memory name -> id map.
  // ---------------------------------------------------------------------------
  const [genreRows] = await conn.query(
    `SELECT DISTINCT genre FROM stg_steam_genre WHERE genre IS NOT NULL`,
  );
  const genreValues = [];
  for (const { genre } of genreRows) {
    const name = cleanText(genre);
    if (!name) continue;
    const slug = slugify(name);
    if (!slug) {
      run.warn(name, 'genre name produced an empty slug');
      continue;
    }
    genreValues.push([name.slice(0, 60), slug.slice(0, 60)]);
  }
  if (genreValues.length > 0) {
    await conn.query(
      'INSERT INTO genre (name, slug) VALUES ? ON DUPLICATE KEY UPDATE name = VALUES(name)',
      [genreValues],
    );
  }
  const [allGenres] = await conn.query('SELECT genre_id, slug FROM genre');
  const genreIdBySlug = new Map(allGenres.map((g) => [g.slug, g.genre_id]));
  console.log(`    genres: ${genreIdBySlug.size} in catalog`);

  // ---------------------------------------------------------------------------
  // 2. Categories per app, for the multiplayer derivation.
  // ---------------------------------------------------------------------------
  const [catRows] = await conn.query(
    'SELECT steam_appid, category FROM stg_steam_category WHERE category IS NOT NULL',
  );
  const multiplayerApps = new Set();
  const partySizeByApp = new Map();
  for (const { steam_appid: appId, category } of catRows) {
    if (MULTIPLAYER_CATEGORIES.has(category)) multiplayerApps.add(appId);
    const size = partySizeFromCategory(category);
    if (size !== null) {
      // Several categories can state a size; the largest is the party ceiling.
      partySizeByApp.set(appId, Math.max(partySizeByApp.get(appId) ?? 0, size));
    }
  }
  console.log(
    `    categories: ${catRows.length} rows -> ${multiplayerApps.size} multiplayer apps, ` +
      `${partySizeByApp.size} with a stated party size`,
  );

  // ---------------------------------------------------------------------------
  // 3. Games: filter, parse, slug, de-duplicate, upsert.
  // ---------------------------------------------------------------------------
  const [staged] = await conn.query(
    `SELECT steam_appid, name, release_date, app_type, owners_range
       FROM stg_steam_game
      ORDER BY steam_appid`,
  );
  run.rowsIn = staged.length;

  // slug -> the winning candidate so far
  const bySlug = new Map();

  for (const row of staged) {
    if (row.app_type !== 'game') {
      run.reject(row.steam_appid, `not a game (app_type=${row.app_type ?? 'unknown'})`, {
        app_id: row.steam_appid,
        type: row.app_type,
      });
      continue;
    }
    const title = cleanText(row.name);
    if (!title) {
      run.reject(row.steam_appid, 'missing title after cleaning', row);
      continue;
    }
    const slug = slugify(title);
    if (!slug) {
      // Titles that are entirely non-Latin script slug to nothing. They are
      // real games, so this is recorded rather than discarded quietly.
      run.reject(row.steam_appid, 'title produced an empty slug', { title });
      continue;
    }

    const releaseDate = parseReleaseDate(row.release_date);
    if (
      releaseDate === null &&
      row.release_date != null &&
      !NULL_SENTINELS.has(String(row.release_date).trim())
    ) {
      run.warn(
        row.steam_appid,
        `unparseable release_date "${String(row.release_date).slice(0, 40)}"`,
        null,
      );
    }

    const owners = ownersLowerBound(row.owners_range);
    const candidate = {
      appId: row.steam_appid,
      title: title.slice(0, 255),
      slug,
      releaseDate,
      owners,
      ownersRange: NULL_SENTINELS.has(String(row.owners_range ?? '').trim())
        ? null
        : (cleanText(row.owners_range)?.slice(0, 40) ?? null),
      isMultiplayer: multiplayerApps.has(row.steam_appid) ? 1 : 0,
      maxPartySize: partySizeByApp.get(row.steam_appid) ?? null,
    };

    const existing = bySlug.get(slug);
    if (!existing) {
      bySlug.set(slug, candidate);
      continue;
    }
    // Deterministic tiebreak: more owners wins; on a tie, the lower appid
    // (the original release rather than a re-publish) wins.
    const challengerWins =
      candidate.owners > existing.owners ||
      (candidate.owners === existing.owners && candidate.appId < existing.appId);
    const loser = challengerWins ? existing : candidate;
    if (challengerWins) bySlug.set(slug, candidate);
    run.reject(
      loser.appId,
      `duplicate slug "${slug}" — lost tiebreak to appid ${challengerWins ? candidate.appId : existing.appId}`,
      { title: loser.title, owners: loser.owners },
    );
  }

  const games = [...bySlug.values()];
  console.log(`    games: ${games.length} unique slugs from ${staged.length} staged rows`);

  for (let i = 0; i < games.length; i += BATCH) {
    const chunk = games
      .slice(i, i + BATCH)
      .map((g) => [
        g.title,
        g.slug,
        g.releaseDate,
        g.appId,
        steamHeaderUrl(g.appId),
        g.ownersRange,
        g.isMultiplayer,
        g.maxPartySize,
      ]);
    await conn.query(
      `INSERT INTO game
         (title, slug, release_date, steam_appid, cover_url, estimated_owners,
          is_multiplayer, max_party_size)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), release_date = VALUES(release_date),
         cover_url = VALUES(cover_url), estimated_owners = VALUES(estimated_owners),
         is_multiplayer = VALUES(is_multiplayer), max_party_size = VALUES(max_party_size)`,
      [chunk],
    );
    if ((i / BATCH) % 20 === 0)
      console.log(`    games: upserted ${Math.min(i + BATCH, games.length)}`);
  }
  run.rowsLoaded = games.length;

  // ---------------------------------------------------------------------------
  // 4. game_genre and game_platform, keyed off the promoted games only.
  // ---------------------------------------------------------------------------
  const [gameIdRows] = await conn.query(
    'SELECT game_id, steam_appid FROM game WHERE steam_appid IS NOT NULL',
  );
  const gameIdByAppId = new Map(gameIdRows.map((g) => [g.steam_appid, g.game_id]));

  const [stgGenres] = await conn.query(
    'SELECT steam_appid, genre FROM stg_steam_genre WHERE genre IS NOT NULL',
  );
  // A Set de-duplicates the (app, genre) pairs the source repeats, which is
  // what the composite primary key would reject anyway.
  const genrePairs = new Set();
  for (const { steam_appid: appId, genre } of stgGenres) {
    const gameId = gameIdByAppId.get(appId);
    if (!gameId) continue; // app was not promoted (demo, duplicate, etc.)
    const genreId = genreIdBySlug.get(slugify(cleanText(genre) ?? ''));
    if (!genreId) continue;
    genrePairs.add(`${gameId}:${genreId}`);
  }
  const genreLinks = [...genrePairs].map((k) => k.split(':').map(Number));
  for (let i = 0; i < genreLinks.length; i += BATCH) {
    await conn.query('INSERT IGNORE INTO game_genre (game_id, genre_id) VALUES ?', [
      genreLinks.slice(i, i + BATCH),
    ]);
  }
  console.log(`    game_genre: ${genreLinks.length} links`);

  // Platform: every app in this source is a Steam app, and Steam is a PC
  // storefront, so every promoted game maps to platform_id 1 (PC). Steam's
  // windows/mac/linux distinction collapses to our single PC platform by
  // design (docs/schema.md). Console platforms are not derivable from this
  // source and are left to the RAWG/IGDB enrichment rather than guessed.
  const PC_PLATFORM_ID = 1;
  const platformLinks = [...gameIdByAppId.values()].map((id) => [id, PC_PLATFORM_ID]);
  for (let i = 0; i < platformLinks.length; i += BATCH) {
    await conn.query('INSERT IGNORE INTO game_platform (game_id, platform_id) VALUES ?', [
      platformLinks.slice(i, i + BATCH),
    ]);
  }
  console.log(`    game_platform: ${platformLinks.length} links`);

  return (
    `Promoted ${games.length} games from ${staged.length} staged rows; ` +
    `${genreLinks.length} genre links, ${platformLinks.length} platform links.`
  );
});
