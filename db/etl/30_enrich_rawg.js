/**
 * ETL stage 30 — RAWG enrichment: cover art, genres and a short description
 * for the games that matter most.
 *
 * This is the ONLY writer of `game.cover_url`. The transform stage (20)
 * deliberately leaves it NULL — see the NOTE at the top of that file — so a
 * non-NULL cover_url here is always backed by a real API response, never a
 * constructed guess.
 *
 * Requires RAWG_API_KEY (free, from https://rawg.io/apidocs — sign up, copy
 * the key). If it is absent, this stage logs a clear line, records why in
 * etl_run.notes, and exits 0 — it never crashes the pipeline and never
 * fabricates enrichment data (§1.7B). The caller (etl:all) treats a skipped
 * enrichment stage as expected, not a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runStage, cleanText, CACHE_DIR } from './_etl_lib.js';

const RAWG_CACHE_DIR = path.join(CACHE_DIR, 'rawg');
const API_BASE = 'https://api.rawg.io/api';
// How many of the top-owned games to attempt enrichment for. RAWG's free tier
// is generous but not unlimited, and the product only needs cover art for the
// games people actually browse — the long tail of 100k+ niche titles does not
// need a hero image.
const TOP_N = Number(process.env.RAWG_ENRICH_LIMIT ?? 500);
// Confidence threshold for the title match. Below this we log a reject
// instead of attaching a possibly-wrong cover to the wrong game.
const MIN_TITLE_SIMILARITY = 0.82;

function normalizeTitle(t) {
  return t
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Levenshtein-based similarity in [0,1]. Small strings, so O(n*m) is fine. */
function similarity(a, b) {
  a = normalizeTitle(a);
  b = normalizeTitle(b);
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  const dist = dp[a.length][b.length];
  return 1 - dist / Math.max(a.length, b.length);
}

/** sha256 of the request so identical searches share one cache file forever. */
function cacheKey(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

/** A token-bucket-ish delay: RAWG's free tier is ~1 req/sec sustained. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetches `url`, using the on-disk cache first so a re-run costs nothing. */
async function cachedFetch(url, run, naturalKey) {
  const key = cacheKey(url);
  const cachePath = path.join(RAWG_CACHE_DIR, `${key}.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }

  let attempt = 0;
  for (;;) {
    attempt += 1;
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      // Network-level failure (DNS, connection refused, proxy block). This is
      // distinct from a 4xx/5xx — it means the host could not be reached at
      // all, which this pipeline must treat as "enrichment unavailable in
      // this environment," not a per-row rejection.
      throw new NetworkUnavailableError(err.message);
    }
    if (res.status === 429) {
      if (attempt > 5) {
        run.warn(naturalKey, 'RAWG rate limit exceeded after 5 retries', { url });
        return null;
      }
      const backoffMs = Math.min(2 ** attempt * 500, 15000);
      await sleep(backoffMs);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      // RAWG's own error responses are always JSON (e.g. {"detail": "..."}).
      // A non-JSON body on a non-OK status means something OTHER than RAWG
      // answered — a network egress proxy, a corporate firewall, a captive
      // portal. That is an environment problem, not a RAWG API error, and
      // reporting it as "RAWG returned HTTP 403" would misleadingly read as
      // an invalid API key when the key was never actually checked.
      try {
        JSON.parse(text);
      } catch {
        throw new NetworkUnavailableError(
          `non-RAWG response (HTTP ${res.status}): ${text.slice(0, 200)}`,
        );
      }
      run.warn(naturalKey, `RAWG returned HTTP ${res.status}: ${text.slice(0, 200)}`, { url });
      return null;
    }
    const body = await res.json();
    fs.mkdirSync(RAWG_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(body));
    await sleep(1100); // stay under the free tier's sustained rate
    return body;
  }
}

class NetworkUnavailableError extends Error {}

await runStage('rawg', async (conn, run) => {
  const apiKey = process.env.RAWG_API_KEY;
  if (!apiKey) {
    const msg =
      'RAWG_API_KEY is not set — enrichment skipped. ' +
      'Sign up at https://rawg.io/apidocs, copy the key, and set ' +
      'RAWG_API_KEY in .env. Bryan: this is an owner action.';
    console.log(`  [rawg] ${msg}`);
    return `⛔ BLOCKED: ${msg}`;
  }

  const [candidates] = await conn.query(
    `SELECT game_id, title, steam_appid
       FROM game
      WHERE cover_url IS NULL
      ORDER BY CAST(REPLACE(SUBSTRING_INDEX(IFNULL(estimated_owners,'0'), '..', 1), ',', '') AS UNSIGNED) DESC,
               game_id ASC
      LIMIT ?`,
    [TOP_N],
  );
  run.rowsIn = candidates.length;

  if (candidates.length === 0) {
    return 'No candidates: every game already has a cover_url.';
  }

  console.log(`  [rawg] enriching top ${candidates.length} games by estimated owners...`);

  let networkDown = false;
  for (const game of candidates) {
    if (networkDown) {
      run.warn(game.game_id, 'skipped — RAWG unreachable earlier in this run', {
        title: game.title,
      });
      continue;
    }
    const searchUrl = `${API_BASE}/games?key=${apiKey}&search=${encodeURIComponent(game.title)}&page_size=5`;
    let body;
    try {
      body = await cachedFetch(searchUrl, run, game.game_id);
    } catch (err) {
      if (err instanceof NetworkUnavailableError) {
        networkDown = true;
        run.warn(
          game.game_id,
          `RAWG host unreachable (${err.message}) — remaining candidates skipped for this run`,
          { title: game.title },
        );
        continue;
      }
      throw err;
    }
    if (!body) continue; // cachedFetch already logged the reason

    const results = Array.isArray(body.results) ? body.results : [];
    if (results.length === 0) {
      run.reject(game.game_id, 'no RAWG results for title', { title: game.title });
      continue;
    }

    // Fuzzy match on normalized title, requiring a confidence floor rather
    // than blindly taking the first result — RAWG's search is substring-ish
    // and "DOOM" can return "DOOM Eternal" as the top hit.
    let best = null;
    let bestScore = 0;
    for (const candidate of results) {
      const score = similarity(game.title, candidate.name ?? '');
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (!best || bestScore < MIN_TITLE_SIMILARITY) {
      run.reject(
        game.game_id,
        `best RAWG match "${best?.name}" scored ${bestScore.toFixed(2)} < ${MIN_TITLE_SIMILARITY}`,
        {
          title: game.title,
        },
      );
      continue;
    }

    const detailUrl = `${API_BASE}/games/${best.id}?key=${apiKey}`;
    let detail;
    try {
      detail = await cachedFetch(detailUrl, run, game.game_id);
    } catch (err) {
      if (err instanceof NetworkUnavailableError) {
        networkDown = true;
        run.warn(game.game_id, `RAWG host unreachable fetching detail (${err.message})`, {
          title: game.title,
        });
        continue;
      }
      throw err;
    }
    if (!detail) continue;

    const coverUrl = cleanText(detail.background_image);
    const description = cleanText(detail.description_raw)?.slice(0, 1000) ?? null;
    const metacritic =
      typeof detail.metacritic === 'number' && detail.metacritic >= 0 && detail.metacritic <= 100
        ? detail.metacritic
        : null;

    await conn.query(
      `UPDATE game
          SET cover_url = ?, rawg_id = ?, short_description = COALESCE(?, short_description),
              metacritic = COALESCE(?, metacritic), raw_payload = ?
        WHERE game_id = ?`,
      [coverUrl, best.id, description, metacritic, JSON.stringify(detail), game.game_id],
    );
    run.rowsLoaded += 1;
  }

  if (networkDown) {
    const msg =
      'RAWG API host is unreachable from this environment (network policy or ' +
      'connectivity issue, independent of RAWG_API_KEY being set). Verify from ' +
      'a shell with real internet access: curl https://api.rawg.io/api/games?key=<key>&page_size=1';
    console.log(`  [rawg] ${msg}`);
    return `⛔ BLOCKED: ${msg}`;
  }
  return `Enriched ${run.rowsLoaded} of ${candidates.length} candidates.`;
});
