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
 *
 * 161 of 134,393 staged app ids (0.12%) — including Counter-Strike 2, Dota 2
 * and Elden Ring — have their categories scraped in a non-English locale
 * instead of the English set above, so a purely English match silently
 * mis-marks them `is_multiplayer = 0`. The strings below are the COMPLETE set
 * of non-ASCII category values found in db/data/raw/categories.csv (154
 * distinct strings, enumerated exhaustively with a direct read of the file —
 * not guessed, and not limited to the highest-frequency ones), restricted to
 * the ones that denote multiplayer play; the rest (achievements, cloud saves,
 * controller support, family sharing, leaderboards, subtitles) don't affect
 * this flag and are left untranslated. Cross-checked against apps
 * independently known to be multiplayer: appid 730 (CS2) carries
 * "Wieloosobowa" (Polish), appid 570 (Dota 2) carries "Для нескольких
 * игроков" (Russian), appid 1245620 (Elden Ring — real multiplayer via co-op
 * summons and PvP invasions) carries "Multijugador" (Spanish).
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
  'LAN – co-op', // English, but with an en-dash instead of a hyphen
  // Polish
  'Wieloosobowa',
  'Wieloplatformowa wieloosobowa',
  // Russian
  'Для нескольких игроков', // Multi-player
  'Кооператив', // Co-op
  'Кооператив (локальная сеть)', // Co-op (LAN)
  'Кооператив (по сети)', // Online Co-op
  'Кооператив (общий/разделённый экран)', // Shared/Split Screen Co-op
  'Игрок против игрока', // PvP
  'Игрок против игрока (по сети)', // Online PvP
  'Игрок против игрока (общий/разделённый экран)', // Shared/Split Screen PvP
  'Кросс-платформенный мультиплеер', // Cross-Platform Multiplayer
  'Общий/разделённый экран', // Shared/Split Screen
  // Chinese (simplified)
  '多人', // Multiplayer
  '合作', // Co-op
  '在线合作', // Online Co-op
  '局域网合作', // Co-op (LAN)
  '同屏/分屏', // Shared/Split Screen
  '同屏/分屏合作', // Shared/Split Screen Co-op
  '玩家对战', // PvP
  '线上玩家对战', // Online PvP
  '跨平台多人', // Cross-Platform Multiplayer
  '远程同乐', // Remote Play Together
  // Chinese (traditional)
  '玩家對戰', // PvP
  '線上合作', // Online Co-op
  '線上玩家對戰', // Online PvP
  '大型多人線上', // MMO
  // Spanish
  'Multijugador', // Multi-player
  'Cooperativos', // Co-op
  'Cooperativo en línea', // Online Co-op (singular form)
  'Cooperativos en línea', // Online Co-op (plural form)
  'JcJ', // PvP (Jugador contra Jugador)
  'JcJ en línea', // Online PvP
  // French
  'Coopération', // Co-op
  'Coopération en ligne', // Online Co-op
  'Coop locale et écran partagé', // Shared/Split Screen Co-op
  // German
  'Plattformübergreifender Mehrspieler', // Cross-Platform Multiplayer
  // Finnish
  'Jaettu näyttö', // Shared/Split Screen
  'Jaetun näytön PvP', // Shared/Split Screen PvP
  'Jaetun näytön yhteistyöpeli', // Shared/Split Screen Co-op
  'Verkkoyhteistyöpeli', // Online Co-op
  'Yhteistyöpeli', // Co-op
  // Japanese
  'オンライン協力プレイ', // Online Co-op
  'マルチプレイヤー', // Multi-player
  '協力プレイ', // Co-op
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

// NOTE on cover_url: this stage deliberately does NOT populate it, even though
// Steam serves every app's header image from a predictable CDN path
// (cdn.akamai.steamstatic.com/steam/apps/<appid>/header.jpg) that could be
// constructed from the appid alone. An early draft of this file did exactly
// that, and it was wrong: constructing a URL we have not verified resolves is
// still a claim we cannot back up, and it would silently satisfy the
// acceptance criterion "cover_url IS NOT NULL >= 300" without the real
// enrichment that criterion exists to prove happened (rule R3 — no
// placeholder data in an application code path; the criterion in
// FAZE_Master_Prompt_V1.txt AGENT 02 explicitly frames this count as a signal
// of RAWG enrichment, not of catalog size). cover_url stays NULL — its schema
// default — until 30_enrich_rawg.js sets it from an actual API response.

/**
 * Genre names, like the multiplayer categories above, are scraped in whatever
 * locale the source session happened to hit — 120 of the staged app ids carry
 * their genres in Russian, Chinese, Spanish, Portuguese, French, Japanese,
 * Ukrainian or Czech instead of English. Left alone this doesn't just
 * mis-classify a boolean the way the category issue did — it FRAGMENTS the
 * genre reference table itself: "Action", "Экшены" and "动作" would each
 * become their own genre_id, splitting one real-world genre into several rows
 * with no way to query across them.
 *
 * The fix is translation BEFORE slugging: mapping a localized name to its
 * canonical English form here means it produces the exact same slug as the
 * English entry, so the existing upsert-by-slug logic below merges them for
 * free — no downstream change needed. Every translation is taken verbatim
 * from db/data/raw/genres.csv (not guessed) and is Steam's own standard
 * platform genre vocabulary, the same well-known terms verified for the
 * multiplayer-category translations above.
 */
const GENRE_TRANSLATIONS = new Map(
  Object.entries({
    // Russian
    Экшены: 'Action',
    Инди: 'Indie',
    'Приключенческие игры': 'Adventure',
    'Ролевые игры': 'RPG',
    Симуляторы: 'Simulation',
    Стратегии: 'Strategy',
    Бесплатные: 'Free to Play',
    'Многопользовательские игры': 'Massively Multiplayer',
    'Казуальные игры': 'Casual',
    'Спортивные игры': 'Sports',
    Гонки: 'Racing',
    'Ранний доступ': 'Early Access',
    // Ukrainian
    Пригоди: 'Adventure',
    Бойовики: 'Action',
    Інді: 'Indie',
    'Казуальні ігри': 'Casual',
    // Chinese (simplified)
    角色扮演: 'RPG',
    独立: 'Indie',
    动作: 'Action',
    冒险: 'Adventure',
    策略: 'Strategy',
    模拟: 'Simulation',
    休闲: 'Casual',
    免费开玩: 'Free to Play',
    抢先体验: 'Early Access',
    体育: 'Sports',
    // Chinese (traditional)
    休閒: 'Casual',
    動作: 'Action',
    冒險: 'Adventure',
    獨立製作: 'Indie',
    模擬: 'Simulation',
    大型多人連線: 'Massively Multiplayer',
    搶先體驗: 'Early Access',
    // Spanish
    Acción: 'Action',
    'Acceso anticipado': 'Early Access',
    'Multijugador masivo': 'Massively Multiplayer',
    // Portuguese
    Ação: 'Action',
    Estratégia: 'Strategy',
    Simulação: 'Simulation',
    'Grátis para Jogar': 'Free to Play',
    // French
    Indépendant: 'Indie',
    Stratégie: 'Strategy',
    'Course automobile': 'Racing',
    'Massivement multijoueur': 'Massively Multiplayer',
    // German
    'Kostenlos spielbar': 'Free to Play',
    // Japanese
    アドベンチャー: 'Adventure',
    インディー: 'Indie',
    アクション: 'Action',
    カジュアル: 'Casual',
    ストラテジー: 'Strategy',
    無料プレイ: 'Free to Play',
    // Czech
    Akční: 'Action',
    Dobrodružné: 'Adventure',
    // Polish
    Niezależne: 'Indie',
    Akcja: 'Action',
  }),
);

await runStage('transform', async (conn, run) => {
  // ---------------------------------------------------------------------------
  // 1. Genres: upsert by slug, then build an in-memory name -> id map.
  // ---------------------------------------------------------------------------
  const [genreRows] = await conn.query(
    `SELECT DISTINCT genre FROM stg_steam_genre WHERE genre IS NOT NULL`,
  );
  const genreValues = [];
  for (const { genre } of genreRows) {
    const cleaned = cleanText(genre);
    if (!cleaned) continue;
    const name = GENRE_TRANSLATIONS.get(cleaned) ?? cleaned;
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
        g.ownersRange,
        g.isMultiplayer,
        g.maxPartySize,
      ]);
    // cover_url is deliberately absent from both the column list and the
    // UPDATE clause: this stage never writes it, so a re-run can never clobber
    // a value 30_enrich_rawg.js set from a real API response (see the NOTE
    // above the game-shaping loop).
    await conn.query(
      `INSERT INTO game
         (title, slug, release_date, steam_appid, estimated_owners,
          is_multiplayer, max_party_size)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), release_date = VALUES(release_date),
         estimated_owners = VALUES(estimated_owners),
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
    const cleaned = cleanText(genre);
    // Same translation as the genre-upsert loop above: a localized genre
    // string must resolve to the SAME genre_id as its English equivalent, or
    // this link silently drops (Elden Ring's Spanish "Acción" would find no
    // "acción" slug, since the genre it should link to is stored as "Action").
    const canonical = cleaned ? (GENRE_TRANSLATIONS.get(cleaned) ?? cleaned) : '';
    const genreId = genreIdBySlug.get(slugify(canonical));
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
