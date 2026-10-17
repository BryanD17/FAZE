/**
 * Demo data: 40 users, 15 groups and 200 messages, so the screens and the
 * match page have something real to show.
 *
 *   npm run db:seed
 *
 * Safe to run twice: every demo account has an `@demo.faze` email, and the
 * script deletes exactly those accounts (and what they own) before inserting
 * them again. Needs the game catalog first (`npm run etl:all`).
 *
 * All data lives in this one file on purpose: `db:reset` runs every `.js` file
 * in db/seeds/, so a separate data module would be run as a second seed.
 *
 * Users are written straight to the database, not through
 * POST /api/auth/register: registration is rate limited to 5 per 15 minutes.
 */
import argon2 from 'argon2';
import { connect, dbConfig, assertNotProduction, banner } from '../scripts/_lib.js';

assertNotProduction('db:seed');

const EMAIL_DOMAIN = '@demo.faze';
const DEMO_PASSWORD = 'DemoPass123';

// Same argon2id parameters as server/src/services/passwords.ts.
const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// Fixed ids from db/migrations/0001_init_lookup_tables.sql.
const REGION = { naEast: 1, naWest: 2, euWest: 3, euEast: 4, sa: 5, apac: 6, oce: 7 };
const LANG = { en: 1, es: 2, pt: 3, fr: 4, de: 5, ru: 6, ko: 8, zh: 9, pl: 12 };
const PLATFORM = { pc: 1, ps: 2, xbox: 3, switch: 4 };
const TAG = { casual: 1, competitive: 2, ranked: 3, chill: 5, coach: 6, firstTimer: 7 };

// Slugs are stable across ETL runs; game_id values are not.
const GAMES = {
  cs2: 'counter-strike-2',
  dota: 'dota-2',
  rl: 'rocket-league',
  apex: 'apex-legendstm',
  ow: 'overwatch-2',
  d2: 'destiny-2',
  drg: 'deep-rock-galactic',
  hd2: 'helldiverstm-2',
  lc: 'lethal-company',
  rivals: 'marvel-rivals',
  wf: 'warframe',
  pubg: 'pubg-battlegrounds',
  tf2: 'team-fortress-2',
  phasmo: 'phasmophobia',
  amongUs: 'among-us',
  l4d2: 'left-4-dead-2',
  ff14: 'final-fantasy-xiv-online',
  mhw: 'monster-hunter-world',
};

/*
 * Availability is [days, startHour, endHour] in UTC (0 = Sunday), one row per
 * day. Each region plays in its own local evening, so people in the same
 * region overlap and the availability part of the match score means something.
 */
// prettier-ignore
const USERS = [
  // EU-West
  { key: 'maya', name: 'Maya Chen', region: 'euWest', lang: 'en', tz: 'Europe/London', platforms: ['pc'], tags: ['competitive', 'chill'], games: ['cs2', 'hd2', 'drg'], slots: [[[1, 2, 3, 4], 18, 22], [[6], 14, 18]], bio: 'Co-op after work, CS2 when I feel brave.' },
  { key: 'liam', name: 'Liam Walsh', region: 'euWest', lang: 'en', tz: 'Europe/Dublin', platforms: ['pc'], tags: ['competitive', 'ranked'], games: ['cs2', 'rivals'], slots: [[[1, 2, 3], 19, 23], [[0], 15, 19]], bio: 'Entry fragger. Will buy you a drop.' },
  { key: 'sofia', name: 'Sofia Ruiz', region: 'euWest', lang: 'es', tz: 'Europe/Madrid', platforms: ['pc'], tags: ['competitive'], games: ['cs2', 'apex'], slots: [[[1, 3, 5], 18, 22], [[6], 12, 16]], bio: 'AWP main, calm comms.' },
  { key: 'lukas', name: 'Lukas Becker', region: 'euWest', lang: 'de', tz: 'Europe/Berlin', platforms: ['pc'], tags: ['casual', 'chill'], games: ['cs2', 'drg', 'lc'], slots: [[[2, 3, 4], 18, 21], [[6], 16, 20]], bio: 'Mostly here for the laughs.' },
  { key: 'emma', name: 'Emma Laurent', region: 'euWest', lang: 'fr', tz: 'Europe/Paris', platforms: ['pc', 'ps'], tags: ['competitive', 'coach'], games: ['cs2', 'ow'], slots: [[[1, 4], 19, 23], [[5], 18, 22]], bio: 'Happy to review demos.' },
  { key: 'oliver', name: 'Oliver Grant', region: 'euWest', lang: 'en', tz: 'Europe/London', platforms: ['pc', 'ps'], tags: ['casual', 'chill'], games: ['hd2', 'cs2'], slots: [[[1, 2, 3], 18, 22], [[6], 15, 19]], bio: 'For Super Earth.' },
  { key: 'chloe', name: 'Chloe Martin', region: 'euWest', lang: 'en', tz: 'Europe/London', platforms: ['pc'], tags: ['chill'], games: ['hd2', 'lc', 'drg'], slots: [[[1, 2, 4], 19, 22], [[0], 14, 18]], bio: 'Co-op games and good company.' },
  { key: 'noah', name: 'Noah Visser', region: 'euWest', lang: 'en', tz: 'Europe/Amsterdam', platforms: ['pc', 'xbox'], tags: ['casual'], games: ['lc', 'hd2'], slots: [[[3, 4, 5], 18, 22]], bio: 'Bad at horror games, play them anyway.' },
  { key: 'hannah', name: 'Hannah Vogel', region: 'euWest', lang: 'de', tz: 'Europe/Berlin', platforms: ['pc'], tags: ['casual', 'chill'], games: ['lc', 'drg', 'phasmo'], slots: [[[1, 2, 3, 4], 17, 21]], bio: 'Scout main. Rock and stone.' },
  { key: 'freya', name: 'Freya Lund', region: 'euWest', lang: 'en', tz: 'Europe/Copenhagen', platforms: ['pc'], tags: ['competitive', 'ranked'], games: ['cs2', 'drg'], slots: [[[2, 3], 18, 22], [[5], 19, 23], [[6], 13, 17]], bio: 'Premier grinder, IGL when needed.' },
  { key: 'elena', name: 'Elena Moreno', region: 'euWest', lang: 'es', tz: 'Europe/Madrid', platforms: ['ps', 'pc'], tags: ['casual', 'firstTimer'], games: ['hd2', 'drg'], slots: [[[1, 2, 3], 18, 22], [[0], 16, 20]], bio: 'New to co-op shooters, learning fast.' },
  // NA-East
  { key: 'jordan', name: 'Jordan Brooks', region: 'naEast', lang: 'en', tz: 'America/New_York', platforms: ['pc', 'ps'], tags: ['competitive', 'ranked'], games: ['apex', 'ow', 'hd2'], slots: [[[1, 2, 3, 4], 22, 24], [[6], 18, 22]], bio: 'Ranked most weeknights.' },
  { key: 'ava', name: 'Ava Thompson', region: 'naEast', lang: 'en', tz: 'America/New_York', platforms: ['ps'], tags: ['competitive'], games: ['apex', 'rivals'], slots: [[[1, 3, 5], 22, 24], [[0], 19, 23]], bio: 'Wraith main, loud pings.' },
  { key: 'ethan', name: 'Ethan Park', region: 'naEast', lang: 'en', tz: 'America/Toronto', platforms: ['pc', 'xbox'], tags: ['ranked'], games: ['apex', 'ow'], slots: [[[2, 3, 4], 22, 24], [[6], 20, 24]], bio: 'Flex player, any role.' },
  { key: 'marcus', name: 'Marcus Reed', region: 'naEast', lang: 'en', tz: 'America/New_York', platforms: ['pc'], tags: ['competitive', 'coach'], games: ['ow', 'rivals'], slots: [[[1, 2, 3], 21, 24]], bio: 'Support main for six seasons.' },
  { key: 'mia', name: 'Mia Collins', region: 'naEast', lang: 'en', tz: 'America/New_York', platforms: ['ps'], tags: ['casual'], games: ['ow', 'rivals'], slots: [[[1, 2, 4], 22, 24], [[6], 17, 21]], bio: 'DPS, positive vibes only.' },
  { key: 'isabella', name: 'Isabella Diaz', region: 'naEast', lang: 'en', tz: 'America/New_York', platforms: ['pc', 'ps'], tags: ['casual', 'chill'], games: ['rivals', 'ow'], slots: [[[2, 3, 5], 21, 24], [[0], 18, 22]], bio: 'Casual hero shooter fan.' },
  { key: 'tyler', name: 'Tyler Nguyen', region: 'naEast', lang: 'en', tz: 'America/New_York', platforms: ['xbox', 'pc'], tags: ['casual'], games: ['rivals', 'rl'], slots: [[[1, 4, 5], 22, 24]], bio: 'Weekend warrior on weeknights.' },
  { key: 'chris', name: 'Chris Morgan', region: 'naEast', lang: 'en', tz: 'America/New_York', platforms: ['pc'], tags: ['competitive'], games: ['apex', 'cs2'], slots: [[[2, 3, 4], 22, 24], [[6], 19, 23]], bio: 'Looking for a regular squad.' },
  // NA-West
  { key: 'kai', name: 'Kai Nakamura', region: 'naWest', lang: 'en', tz: 'America/Los_Angeles', platforms: ['pc', 'ps'], tags: ['competitive'], games: ['rl', 'd2'], slots: [[[2, 3, 4, 5], 2, 6]], bio: 'Diamond in 3s, aiming for Champ.' },
  { key: 'zoe', name: 'Zoe Bennett', region: 'naWest', lang: 'en', tz: 'America/Los_Angeles', platforms: ['ps', 'switch'], tags: ['casual'], games: ['rl', 'd2'], slots: [[[2, 4, 6], 2, 6]], bio: 'Hunter main, rocket car enjoyer.' },
  { key: 'sam', name: 'Sam Rivera', region: 'naWest', lang: 'en', tz: 'America/Los_Angeles', platforms: ['switch', 'pc'], tags: ['casual', 'chill'], games: ['rl', 'amongUs'], slots: [[[3, 5], 1, 5], [[0], 20, 24]], bio: 'Party games and car soccer.' },
  { key: 'daniel', name: 'Daniel Kim', region: 'naWest', lang: 'en', tz: 'America/Los_Angeles', platforms: ['pc', 'xbox'], tags: ['coach'], games: ['d2', 'phasmo'], slots: [[[1, 2, 3], 3, 7]], bio: 'Raid sherpa, patient teacher.' },
  { key: 'ryan', name: 'Ryan Foster', region: 'naWest', lang: 'en', tz: 'America/Vancouver', platforms: ['pc'], tags: ['casual'], games: ['d2', 'phasmo'], slots: [[[2, 3, 4], 2, 6], [[0], 21, 24]], bio: 'Titan punching things since D1.' },
  { key: 'priya', name: 'Priya Shah', region: 'naWest', lang: 'en', tz: 'America/Los_Angeles', platforms: ['pc'], tags: ['chill'], games: ['phasmo', 'l4d2', 'amongUs'], slots: [[[3, 4, 5], 3, 7], [[6], 22, 24]], bio: 'Ghost hunter, zombie survivor.' },
  { key: 'nina', name: 'Nina Petrova', region: 'naWest', lang: 'en', tz: 'America/Los_Angeles', platforms: ['pc', 'ps'], tags: ['casual'], games: ['d2', 'ff14'], slots: [[[2, 3], 2, 6], [[6], 19, 23]], bio: 'MMO healer looking for a static.' },
  // South America
  { key: 'gabriel', name: 'Gabriel Souza', region: 'sa', lang: 'pt', tz: 'America/Sao_Paulo', platforms: ['pc'], tags: ['competitive', 'ranked'], games: ['cs2', 'pubg'], slots: [[[1, 2, 3, 4], 22, 24]], bio: 'IGL do time, bora jogar.' },
  { key: 'lucas', name: 'Lucas Almeida', region: 'sa', lang: 'pt', tz: 'America/Sao_Paulo', platforms: ['pc'], tags: ['competitive'], games: ['cs2', 'apex'], slots: [[[1, 3, 5], 21, 24]], bio: 'Rifler, sempre online a noite.' },
  { key: 'mariana', name: 'Mariana Lopez', region: 'sa', lang: 'es', tz: 'America/Argentina/Buenos_Aires', platforms: ['pc'], tags: ['casual'], games: ['cs2', 'rl'], slots: [[[2, 3, 4], 22, 24], [[6], 18, 22]], bio: 'Support player, good vibes.' },
  { key: 'rafael', name: 'Rafael Costa', region: 'sa', lang: 'pt', tz: 'America/Sao_Paulo', platforms: ['pc'], tags: ['ranked'], games: ['cs2', 'dota'], slots: [[[1, 2, 5], 22, 24]], bio: 'Lurker. Joga de tudo.' },
  // EU-East
  { key: 'jakub', name: 'Jakub Nowak', region: 'euEast', lang: 'pl', tz: 'Europe/Warsaw', platforms: ['pc'], tags: ['ranked', 'coach'], games: ['dota', 'cs2'], slots: [[[1, 2, 3, 4], 17, 21]], bio: 'Mid player, 4k hours.' },
  { key: 'anna', name: 'Anna Kowalska', region: 'euEast', lang: 'pl', tz: 'Europe/Warsaw', platforms: ['pc'], tags: ['casual'], games: ['dota', 'l4d2'], slots: [[[1, 3, 5], 18, 21]], bio: 'Position 5, will ward.' },
  { key: 'dmitri', name: 'Dmitri Volkov', region: 'euEast', lang: 'ru', tz: 'Europe/Moscow', platforms: ['pc'], tags: ['competitive'], games: ['dota', 'wf'], slots: [[[2, 3, 4], 17, 21], [[6], 12, 16]], bio: 'Offlaner, calm under pressure.' },
  { key: 'katarzyna', name: 'Katarzyna Zielinska', region: 'euEast', lang: 'pl', tz: 'Europe/Warsaw', platforms: ['pc'], tags: ['chill'], games: ['dota', 'tf2'], slots: [[[1, 2, 4], 17, 20]], bio: 'Plays support in every game.' },
  // Asia Pacific
  { key: 'minjun', name: 'Minjun Lee', region: 'apac', lang: 'ko', tz: 'Asia/Seoul', platforms: ['pc'], tags: ['competitive', 'ranked'], games: ['pubg', 'ow'], slots: [[[1, 2, 3, 4], 11, 15]], bio: 'Chicken dinner hunter.' },
  { key: 'wei', name: 'Wei Zhang', region: 'apac', lang: 'zh', tz: 'Asia/Shanghai', platforms: ['pc'], tags: ['casual'], games: ['pubg', 'dota'], slots: [[[2, 3, 5], 12, 15], [[6], 6, 10]], bio: 'Sniper, patient player.' },
  { key: 'arjun', name: 'Arjun Mehta', region: 'apac', lang: 'en', tz: 'Asia/Kolkata', platforms: ['pc'], tags: ['casual', 'chill'], games: ['pubg', 'wf'], slots: [[[1, 3, 4], 14, 17]], bio: 'Evenings IST, chill squads.' },
  // Oceania
  { key: 'jack', name: 'Jack Wilson', region: 'oce', lang: 'en', tz: 'Australia/Sydney', platforms: ['pc', 'ps'], tags: ['coach'], games: ['wf', 'mhw'], slots: [[[1, 2, 3], 8, 12], [[6], 2, 6]], bio: 'MR 30, happy to help new Tenno.' },
  { key: 'olivia', name: 'Olivia Harris', region: 'oce', lang: 'en', tz: 'Australia/Melbourne', platforms: ['pc'], tags: ['casual'], games: ['wf', 'ff14'], slots: [[[2, 3, 4], 9, 12]], bio: 'Fashion frame is end game.' },
  { key: 'ruby', name: 'Ruby Clarke', region: 'oce', lang: 'en', tz: 'Australia/Brisbane', platforms: ['xbox', 'pc'], tags: ['chill'], games: ['wf', 'l4d2'], slots: [[[1, 3, 5], 8, 11]], bio: 'Co-op only, no PvP stress.' },
];

/*
 * The owner joins through sp_create_group; `members` join through
 * sp_join_group. `cs2-full` is the one group filled exactly to max_members, so
 * the "Group full" state can be shown.
 */
// prettier-ignore
const GROUPS = [
  { owner: 'liam', game: 'cs2', region: 'euWest', lang: 'en', max: 4, members: ['sofia', 'lukas', 'emma'], title: 'CS2 Premier squad (full for now)', description: 'Fixed squad for Premier nights. Seats are taken this season, check back later.', lines: ['who is on for Premier tonight?', 'we need to fix our B retakes', 'smokes for Mirage are in the pinned doc', 'that eco round win was huge'] },
  { owner: 'oliver', game: 'hd2', region: 'euWest', lang: 'en', max: 6, members: ['chloe', 'noah', 'jordan'], title: 'Helldivers 2 evening drops (Diff 7+)', description: 'Spreading managed democracy after work. Mic preferred, no friendly-fire drama.', lines: ['new major order is up, let us go', 'who keeps calling the orbital on me', 'bringing the recoilless tonight', 'samples secured, extracting'] },
  { owner: 'hannah', game: 'lc', region: 'euWest', lang: 'en', max: 4, members: ['lukas', 'noah'], title: 'Lethal Company: making quota since day one', description: 'Spooky, silly, mostly screaming. New players welcome.', lines: ['quota is 400, we can do this', 'do not open that door', 'I sold the cash register, we are rich', 'who left the ship lights off'] },
  { owner: 'freya', game: 'cs2', region: 'euWest', lang: 'en', max: 5, members: ['sofia', 'oliver'], title: 'CS2 Premier evenings, chill comms', description: 'Around 12k rating. We review demos on Sundays. Calm callouts only.', lines: ['queue up at 7?', 'demo review Sunday, bring snacks', 'I will play anchor on B', 'we need one more for a full stack'] },
  { owner: 'maya', game: 'drg', region: 'euWest', lang: 'en', max: 4, members: ['chloe', 'hannah'], title: 'Deep Rock Galactic: Haz 4 after work', description: 'Rock and stone! Scout and driller covered, gunners and engineers welcome.', lines: ['rock and stone!', 'deep dive is up this week', 'I will bring the platform gun', 'did I hear a rock and stone?'] },
  { owner: 'jordan', game: 'apex', region: 'naEast', lang: 'en', max: 5, members: ['ava', 'ethan'], title: 'Apex ranked grind: Gold to Plat', description: 'Ranked most weeknights. Looking for steady teammates, not randoms.', lines: ['anyone up for ranked tonight?', 'drop Fragment or somewhere quieter?', 'we were one ring away from the win', 'new legend looks strong'] },
  { owner: 'marcus', game: 'ow', region: 'naEast', lang: 'en', max: 5, members: ['jordan', 'ethan', 'mia'], title: 'Overwatch 2 role queue: need a tank', description: 'Two supports and two DPS locked in. A main tank would complete us.', lines: ['still looking for a tank main', 'group up before we push', 'nice nano on that last fight', 'I can flex tank if we are stuck'] },
  { owner: 'isabella', game: 'rivals', region: 'naEast', lang: 'en', max: 6, members: ['marcus', 'tyler'], title: 'Marvel Rivals casual team-ups', description: 'Quick play and the odd ranked match. All heroes, all skill levels.', lines: ['team-up combos tonight?', 'I will play strategist', 'that ult combo was beautiful', 'anyone tried the new map?'] },
  { owner: 'kai', game: 'rl', region: 'naWest', lang: 'en', max: 4, members: ['zoe', 'sam'], title: 'Rocket League 3v3 standard, Diamond-ish', description: 'Late-night 3s. We rotate properly most of the time.', lines: ['3s at 7 pacific?', 'what a save!', 'rotate back post please', 'one more and I am done'] },
  { owner: 'daniel', game: 'd2', region: 'naWest', lang: 'en', max: 6, members: ['kai', 'zoe', 'ryan'], title: 'Destiny 2 raid team: weekly clears', description: 'Running the current raid every Tuesday. Sherpa runs for first-timers.', lines: ['raid Tuesday, same time', 'who has the checkpoint?', 'I can run callouts for the final encounter', 'flawless next week?'] },
  { owner: 'priya', game: 'phasmo', region: 'naWest', lang: 'en', max: 4, members: ['daniel', 'ryan'], title: 'Phasmophobia: nightmare ghost hunts', description: 'Evidence-light runs. No sprinting into the ghost room, please.', lines: ['I think it is a Banshee', 'who has the crucifix', 'it just turned the breaker off', 'that hunt was terrifying'] },
  { owner: 'gabriel', game: 'cs2', region: 'sa', lang: 'pt', max: 5, members: ['lucas', 'mariana', 'rafael'], title: 'CS2 Premier BR: Sao Paulo servers', description: 'Squad brasileiro, jogamos a noite. English is fine too.', lines: ['bora jogar hoje?', 'boa rodada, time!', 'quem vai de AWP?', 'treino de granadas amanha'] },
  { owner: 'jakub', game: 'dota', region: 'euEast', lang: 'en', max: 5, members: ['anna', 'dmitri', 'katarzyna'], title: 'Dota 2 ranked party, Archon to Legend', description: 'Evening ranked on EU East. We play to learn, not to flame.', lines: ['party ranked at 8?', 'I will take mid, who supports?', 'Roshan is up, group up', 'gg, that comeback was wild'] },
  { owner: 'minjun', game: 'pubg', region: 'apac', lang: 'en', max: 4, members: ['wei', 'arjun'], title: 'PUBG squads on Asia servers', description: 'Erangel and Miramar squads after work. Callouts in English.', lines: ['squads at 8 KST?', 'landing Pochinki?', 'chicken dinner!', 'I have a spare 8x scope'] },
  { owner: 'jack', game: 'wf', region: 'oce', lang: 'en', max: 4, members: ['olivia', 'ruby'], title: 'Warframe Steel Path farming', description: 'Running Steel Path and the weekly archon hunt. Happy to help newer Tenno.', lines: ['archon hunt is up', 'farming steel essence tonight', 'need a hand with this relic?', 'new prime access looks good'] },
];

// Messages per group, in GROUPS order; adds up to 200.
const MESSAGE_COUNTS = [14, 20, 12, 16, 18, 15, 14, 12, 10, 14, 12, 13, 12, 10, 8];

/** Game-neutral chat, mixed with each group's own lines above. */
const CHAT = [
  'anyone on tonight?',
  'I can hop on in 20 min',
  'gg everyone, that last one was close',
  'same time tomorrow?',
  'running a bit late, start without me',
  'my internet is being weird, brb',
  'cleanest game we have had all week',
  'who is free this weekend?',
  'I will be on after dinner',
  'sorry I had to leave mid-match, family stuff',
  'new patch dropped, anyone read the notes?',
  'can we do a couple of warm-up games first?',
  'voice channel is up whenever you are ready',
  'nice clutch earlier',
  'I am down for one more',
  'heading to bed, gn all',
  'morning! anyone up for a session later?',
  'that lag spike was not my fault I promise',
  'we should try a different plan next time',
  'just got off work, give me 10',
  'let us keep it chill tonight',
  'who has the invite link?',
  'good games yesterday',
  'my headset died, I will be on text chat',
  'can someone remind me of the plan?',
  'I will host this time',
  'is everyone ok with starting at 8?',
  'need to update first, huge download',
  'welcome to the new folks!',
  'that was hilarious, someone clip it',
  'trying a new setup tonight, be patient with me',
  'we are getting better every week',
  'away this weekend, back Monday',
  'watched a guide video, I have some ideas',
  'anyone want to duo before the others get on?',
  'mic check, can you hear me?',
  'that was rough, let us reset',
  'thanks for carrying me last night',
  'can we swap roles for a change?',
  'see you all at the usual time',
  'I am on but stuck in a queue',
  'one sec, grabbing a drink',
  'lol that ending',
  'ready when you are',
  'great session, same again Thursday?',
];

const DAY_MS = 24 * 60 * 60 * 1000;

async function resolveGames(conn) {
  const slugs = Object.values(GAMES);
  const [rows] = await conn.query('SELECT game_id, slug FROM game WHERE slug IN (?)', [slugs]);
  const idBySlug = new Map(rows.map((r) => [r.slug, r.game_id]));
  const missing = slugs.filter((s) => !idBySlug.has(s));
  if (missing.length > 0) {
    throw new Error(
      `Games missing from the catalog: ${missing.join(', ')}. Run \`npm run etl:all\` first.`,
    );
  }
  return Object.fromEntries(Object.entries(GAMES).map(([key, slug]) => [key, idBySlug.get(slug)]));
}

/**
 * Removes the previous demo data. Memberships are deleted explicitly first:
 * foreign-key cascades do not fire triggers in MySQL, so a demo user's
 * membership in a non-demo group would otherwise leave member_count wrong.
 */
async function removeDemoData(conn) {
  const [rows] = await conn.query('SELECT user_id FROM `user` WHERE email LIKE ?', [
    `%${EMAIL_DOMAIN}`,
  ]);
  const ids = rows.map((r) => r.user_id);
  if (ids.length === 0) return 0;
  await conn.query('DELETE FROM group_member WHERE user_id IN (?)', [ids]);
  await conn.query('DELETE FROM lfg_group WHERE owner_user_id IN (?)', [ids]);
  await conn.query('DELETE FROM `user` WHERE user_id IN (?)', [ids]);
  return ids.length;
}

async function insertUsers(conn, gameIds) {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, HASH_OPTIONS);
  const userIds = {};

  for (const u of USERS) {
    const [res] = await conn.query(
      `INSERT INTO \`user\` (email, password_hash, status, email_verified_at)
       VALUES (?, ?, 'active', NOW())`,
      [`${u.key}${EMAIL_DOMAIN}`, passwordHash],
    );
    const userId = res.insertId;
    userIds[u.key] = userId;

    await conn.query(
      `INSERT INTO profile (user_id, display_name, bio, region_id, language_id, timezone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, u.name, u.bio, REGION[u.region], LANG[u.lang], u.tz],
    );
    await conn.query('INSERT INTO user_platform (user_id, platform_id) VALUES ?', [
      u.platforms.map((p) => [userId, PLATFORM[p]]),
    ]);
    await conn.query('INSERT INTO user_tag (user_id, tag_id) VALUES ?', [
      u.tags.map((t) => [userId, TAG[t]]),
    ]);
    // The first game is the primary one; primary_owner_id mirrors that (0009).
    await conn.query(
      'INSERT INTO user_game (user_id, game_id, is_primary, primary_owner_id) VALUES ?',
      [u.games.map((g, i) => [userId, gameIds[g], i === 0, i === 0 ? userId : null])],
    );
    await conn.query(
      'INSERT INTO availability_slot (user_id, day_of_week, start_minute, end_minute) VALUES ?',
      [
        u.slots.flatMap(([days, start, end]) =>
          days.map((day) => [userId, day, start * 60, end * 60]),
        ),
      ],
    );
  }
  return userIds;
}

async function insertGroups(conn, gameIds, userIds) {
  const groupIds = [];
  for (const g of GROUPS) {
    const owner = USERS.find((u) => u.key === g.owner);
    const platformCsv = owner.platforms.map((p) => PLATFORM[p]).join(',');
    await conn.query(
      "CALL sp_create_group(?, ?, ?, ?, ?, ?, 'open', ?, 0, NULL, NULL, NULL, ?, @group_id)",
      [
        userIds[g.owner],
        gameIds[g.game],
        g.title,
        g.description,
        REGION[g.region],
        LANG[g.lang],
        g.max,
        platformCsv,
      ],
    );
    const [[{ groupId }]] = await conn.query('SELECT @group_id AS groupId');
    groupIds.push(groupId);

    for (const member of g.members) {
      await conn.query('CALL sp_join_group(?, ?, @result)', [userIds[member], groupId]);
      const [[{ result }]] = await conn.query('SELECT @result AS result');
      if (result !== 'JOINED') {
        throw new Error(`${member} could not join "${g.title}": ${result}`);
      }
    }
  }
  return groupIds;
}

/**
 * Spreads each group's messages evenly over the past week, oldest first.
 * Every fourth message is one of the group's own lines; the rest come from
 * CHAT, starting at a different place for each group so groups differ.
 */
async function insertMessages(conn, userIds, groupIds) {
  const now = Date.now();
  const rows = [];
  GROUPS.forEach((g, gi) => {
    const authors = [g.owner, ...g.members].map((key) => userIds[key]);
    const count = MESSAGE_COUNTS[gi];
    let chatIndex = gi * 11;
    for (let i = 0; i < count; i += 1) {
      const own = i % 4 === 0 ? g.lines[i / 4] : undefined;
      const body = own ?? CHAT[chatIndex++ % CHAT.length];
      const createdAt = new Date(now - 7 * DAY_MS + ((i + 1) * 7 * DAY_MS) / (count + 1));
      rows.push([groupIds[gi], authors[(i + gi) % authors.length], body, createdAt]);
    }
  });
  await conn.query('INSERT INTO message (group_id, user_id, body, created_at) VALUES ?', [rows]);
}

async function printSummary(conn) {
  const [[counts]] = await conn.query({
    namedPlaceholders: true,
    sql: `SELECT
       (SELECT COUNT(*) FROM \`user\` WHERE email LIKE :domain) AS users,
       (SELECT COUNT(*) FROM lfg_group g JOIN \`user\` u ON u.user_id = g.owner_user_id
         WHERE u.email LIKE :domain) AS \`groups\`,
       (SELECT COUNT(*) FROM group_member gm
          JOIN lfg_group g ON g.group_id = gm.group_id
          JOIN \`user\` u ON u.user_id = g.owner_user_id
         WHERE u.email LIKE :domain AND gm.state = 'active') AS members,
       (SELECT COUNT(*) FROM message m
          JOIN lfg_group g ON g.group_id = m.group_id
          JOIN \`user\` u ON u.user_id = g.owner_user_id
         WHERE u.email LIKE :domain) AS messages,
       (SELECT COUNT(*) FROM lfg_group g JOIN \`user\` u ON u.user_id = g.owner_user_id
         WHERE u.email LIKE :domain AND g.status = 'full') AS full_groups,
       (SELECT COUNT(*) FROM v_member_count_reconciliation WHERE drift <> 0) AS drift_rows`,
    values: { domain: `%${EMAIL_DOMAIN}` },
  });
  banner('Summary');
  console.log(`  users:       ${counts.users}`);
  console.log(`  groups:      ${counts.groups} (${counts.full_groups} full)`);
  console.log(`  members:     ${counts.members}`);
  console.log(`  messages:    ${counts.messages}`);
  console.log(`  drift rows:  ${counts.drift_rows} (must be 0)`);
  console.log(`\n  Log in as maya${EMAIL_DOMAIN} / ${DEMO_PASSWORD} (see docs/demo.md).\n`);
}

async function main() {
  banner(`Seeding demo data into \`${dbConfig.database}\``);
  const conn = await connect();
  try {
    // `db:reset` runs this before the ETL (docs/data.md: `db:reset && etl:all`),
    // so an empty catalog is a skip, not a failure.
    const [[{ games }]] = await conn.query('SELECT COUNT(*) AS games FROM game');
    if (games === 0) {
      console.log('  No game catalog yet: run `npm run etl:all`, then `npm run db:seed`.\n');
      return;
    }
    const gameIds = await resolveGames(conn);
    const removed = await removeDemoData(conn);
    console.log(`  removed ${removed} previous demo users`);

    const userIds = await insertUsers(conn, gameIds);
    console.log(`  inserted ${USERS.length} users`);
    const groupIds = await insertGroups(conn, gameIds, userIds);
    console.log(`  created ${groupIds.length} groups`);
    await insertMessages(conn, userIds, groupIds);
    console.log(`  inserted ${MESSAGE_COUNTS.reduce((a, b) => a + b, 0)} messages`);

    await printSummary(conn);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`\n  Seed failed: ${err.message}\n`);
  process.exit(1);
});
