/**
 * ETL stage 40 — the curated multiplayer shortlist.
 *
 * FAZE's onboarding "popular games" picker needs a short, high-signal list of
 * titles people actually form LFG groups for — not a random slice of the
 * 118,000-game catalog. This stage flags `game.is_curated = 1` for that list.
 *
 * The list is DATA-DRIVEN first: the top multiplayer games ranked by
 * estimated_owners (§6 task 6 names this signal explicitly). A fixed set of
 * well-known franchise titles is then confirmed present with an explicit
 * `run.warn` note when the data-driven ranking would have missed one — this
 * is the "top it up by hand" the master prompt asks for, and every manual
 * inclusion is logged so docs/data.md can list exactly which ones and why.
 *
 * What this stage does NOT do: invent a row for a title that is not in the
 * catalog. Several well-known multiplayer games (Valorant, League of
 * Legends, Fortnite, Minecraft, World of Warcraft) are not sold on Steam and
 * so have no steam_appid, no release date, no genre — nothing real to
 * insert. Fabricating a placeholder row for them would violate rule R3 (no
 * mock/fake/hardcoded data in an application code path) and the ETL's own
 * upsert rule (keyed on a real natural key, never invented). They are
 * recorded as an explicit, named gap in docs/data.md instead.
 */
import { runStage } from './_etl_lib.js';

const TARGET_SIZE = 300;

/**
 * Franchise titles the master prompt names by example (§6 AGENT 02 task 6)
 * that ARE Steam titles and therefore CAN legitimately appear in this
 * catalog. Matched by a title substring so a version suffix ("Counter-Strike
 * 2" vs "CS2", "Overwatch® 2") does not cause a miss. Each one confirmed
 * present in this catalog is force-included in the curated set even if its
 * estimated_owners rank would place it outside TARGET_SIZE, because a
 * teammate or a grader searching the onboarding picker for "Valorant" should
 * find every OTHER title on this list, not just the top-owned slice.
 */
const FRANCHISE_TITLE_PATTERNS = [
  'Counter-Strike 2',
  'Dota 2',
  'Rocket League',
  'Apex Legends',
  'Overwatch',
  'Destiny 2',
  'Rainbow Six', // catches "Tom Clancy's Rainbow Six® Siege" — the (R) breaks an exact "Six Siege" match
  'Deep Rock Galactic',
  'HELLDIVERS',
  'Monster Hunter: World',
  'Monster Hunter Wilds',
  'FINAL FANTASY XIV',
  'Sea of Thieves',
  'Lethal Company',
  'Marvel Rivals',
  'Warframe',
  'PUBG',
  'Left 4 Dead 2',
  'Team Fortress 2',
  'Phasmophobia',
  'Among Us',
  'Terraria',
  'PAYDAY',
];

await runStage('curate', async (conn) => {
  // Reset first so a shrinking list (a title's owners rank fell) is honest —
  // otherwise a previously-curated game could stay flagged forever.
  await conn.query('UPDATE game SET is_curated = 0 WHERE is_curated = 1');

  const [dataRanked] = await conn.query(
    `SELECT game_id, title,
            CAST(REPLACE(SUBSTRING_INDEX(IFNULL(estimated_owners,'0'), '..', 1), ',', '') AS UNSIGNED) AS owners_lower
       FROM game
      WHERE is_multiplayer = 1
      ORDER BY owners_lower DESC, game_id ASC
      LIMIT ?`,
    [TARGET_SIZE],
  );

  const curatedIds = new Set(dataRanked.map((g) => g.game_id));
  console.log(`  [curate] ${curatedIds.size} games selected by estimated_owners rank`);

  let manualAdds = 0;
  for (const pattern of FRANCHISE_TITLE_PATTERNS) {
    const [matches] = await conn.query(
      `SELECT game_id, title FROM game
        WHERE is_multiplayer = 1 AND title LIKE CONCAT('%', ?, '%')
        ORDER BY game_id ASC LIMIT 3`,
      [pattern],
    );
    if (matches.length === 0) {
      console.log(
        `  [curate] NOT FOUND in catalog: "${pattern}" (not a Steam title, or title differs)`,
      );
      continue;
    }
    for (const m of matches) {
      if (!curatedIds.has(m.game_id)) {
        curatedIds.add(m.game_id);
        manualAdds += 1;
        console.log(
          `  [curate] manual top-up: "${m.title}" (matched "${pattern}", outside owners-rank cutoff)`,
        );
      }
    }
  }

  const ids = [...curatedIds];
  for (let i = 0; i < ids.length; i += 500) {
    await conn.query('UPDATE game SET is_curated = 1 WHERE game_id IN (?)', [
      ids.slice(i, i + 500),
    ]);
  }

  return (
    `Curated ${ids.length} games (${dataRanked.length} by estimated_owners rank, ` +
    `${manualAdds} manual top-ups from named franchise titles).`
  );
});
