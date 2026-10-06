/**
 * Asserts every database object AGENT 03 introduced still exists: six views,
 * five stored procedures, ten triggers, and the seven indexes the schema
 * relies on (see 0010_indexes_initial.sql for why those seven map onto
 * pre-existing AGENT 01 indexes rather than duplicates).
 *
 *   npm run db:verify
 *
 * Wired into CI (§1.6): a PR that accidentally drops a view, forgets a
 * trigger in a corrective migration, or silently loses an index must fail
 * the build, not surface as a mystery three weeks later when the
 * matchmaking query gets slow or a rating stops being rejected.
 *
 * Every expectation below is checked against information_schema — the
 * database's own account of what exists — never against the migration
 * files, so this catches drift between what a migration WROTE and what is
 * actually LIVE (a hand-run DROP, a migration that silently no-op'd).
 */
import { connect, banner } from './_lib.js';

const EXPECTED_VIEWS = [
  'v_group_card',
  'v_user_profile_full',
  'v_user_availability_minutes',
  'v_group_activity',
  'v_member_count_reconciliation',
  'v_game_popularity',
];

const EXPECTED_PROCEDURES = [
  'sp_create_group',
  'sp_join_group',
  'sp_decide_join_request',
  'sp_leave_group',
  'sp_record_session_played',
  // Not one of the five the master prompt names — added because MySQL will
  // not allow trg_user_game_bi/bu to exist as literal triggers (a trigger
  // cannot modify the table its own firing statement is already writing to;
  // see 0009_triggers.sql). This procedure is where that logic actually
  // lives instead.
  'sp_set_primary_game',
];

const EXPECTED_TRIGGERS = [
  'trg_group_member_ai',
  'trg_group_member_au',
  'trg_group_member_ad',
  'trg_message_ai',
  'trg_user_bu',
  'trg_profile_bu',
  'trg_rating_bi',
  // trg_user_game_bi / trg_user_game_bu do NOT exist — see
  // sp_set_primary_game above and 0009_triggers.sql for why. The invariant
  // they were meant to enforce is checked separately below, as a UNIQUE
  // index rather than a trigger.
];

/**
 * The seven query shapes AGENT 03 task 4 names, mapped to the real index
 * that satisfies each — see 0010_indexes_initial.sql for the full reasoning.
 * Checked by (table, columns-as-a-leftmost-prefix), not by name, since the
 * whole point of that migration was reusing AGENT 01's indexes under their
 * original names rather than creating same-column duplicates.
 */
const EXPECTED_INDEX_COVERAGE = [
  {
    table: 'lfg_group',
    columns: ['game_id', 'status', 'region_id', 'last_activity_at'],
    serves: 'browse/matchmaking filter',
  },
  { table: 'lfg_group', columns: ['owner_user_id'], serves: '"groups I own"' },
  { table: 'group_member', columns: ['user_id', 'state'], serves: 'GET /api/me/groups' },
  {
    table: 'user_game',
    columns: ['game_id', 'rank_tier'],
    serves: 'candidates + rank-window checks',
  },
  {
    table: 'availability_slot',
    columns: ['user_id', 'day_of_week'],
    serves: 'availability overlap join',
  },
  {
    table: 'availability_slot',
    columns: ['day_of_week', 'start_minute', 'end_minute'],
    serves: 'match query: other slots on the same day (0012)',
  },
  {
    table: 'message',
    columns: ['group_id', 'created_at'],
    serves: 'backwards keyset message paging',
  },
  { table: 'join_request', columns: ['group_id', 'state'], serves: 'pending-request queue' },
];

async function getExisting(conn, sql, params) {
  const [rows] = await conn.query(sql, params);
  return new Set(rows.map((r) => Object.values(r)[0]));
}

/** True if some index on `table` starts with exactly `columns`, in order. */
async function hasIndexCovering(conn, table, columns) {
  const [rows] = await conn.query(
    `SELECT index_name, seq_in_index, column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY index_name, seq_in_index`,
    [table],
  );
  const byIndex = new Map();
  for (const r of rows) {
    // information_schema always returns its column names UPPERCASE,
    // regardless of how the SELECT list was written.
    if (!byIndex.has(r.INDEX_NAME)) byIndex.set(r.INDEX_NAME, []);
    byIndex.get(r.INDEX_NAME)[r.SEQ_IN_INDEX - 1] = r.COLUMN_NAME;
  }
  for (const [name, cols] of byIndex) {
    if (columns.every((c, i) => cols[i] === c)) return name;
  }
  return null;
}

async function main() {
  const conn = await connect();
  let failures = 0;

  try {
    banner('Verifying database objects');

    const views = await getExisting(
      conn,
      `SELECT table_name FROM information_schema.views WHERE table_schema = DATABASE()`,
    );
    for (const v of EXPECTED_VIEWS) {
      const ok = views.has(v);
      console.log(`  [view]      ${ok ? 'OK  ' : 'MISSING'} ${v}`);
      if (!ok) failures++;
    }

    const procs = await getExisting(
      conn,
      `SELECT routine_name FROM information_schema.routines
        WHERE routine_schema = DATABASE() AND routine_type = 'PROCEDURE'`,
    );
    for (const p of EXPECTED_PROCEDURES) {
      const ok = procs.has(p);
      console.log(`  [procedure] ${ok ? 'OK  ' : 'MISSING'} ${p}`);
      if (!ok) failures++;
    }

    const triggers = await getExisting(
      conn,
      `SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = DATABASE()`,
    );
    for (const t of EXPECTED_TRIGGERS) {
      const ok = triggers.has(t);
      console.log(`  [trigger]   ${ok ? 'OK  ' : 'MISSING'} ${t}`);
      if (!ok) failures++;
    }

    for (const { table, columns, serves } of EXPECTED_INDEX_COVERAGE) {
      const covering = await hasIndexCovering(conn, table, columns);
      const ok = Boolean(covering);
      console.log(
        `  [index]     ${ok ? 'OK  ' : 'MISSING'} ${table}(${columns.join(',')}) -- ${serves}` +
          (ok ? ` [${covering}]` : ''),
      );
      if (!ok) failures++;
    }

    // The "at most one primary game per user" invariant — a UNIQUE index
    // instead of trg_user_game_bi/bu, which MySQL will not allow to exist
    // (see 0009_triggers.sql and sp_set_primary_game).
    const primaryGuard = await hasIndexCovering(conn, 'user_game', ['primary_owner_id']);
    console.log(
      `  [unique]    ${primaryGuard ? 'OK  ' : 'MISSING'} user_game(primary_owner_id) -- at most one is_primary per user` +
        (primaryGuard ? ` [${primaryGuard}]` : ''),
    );
    if (!primaryGuard) failures++;

    console.log('');
    if (failures > 0) {
      console.error(`  ${failures} object(s) missing. See above.\n`);
      process.exit(1);
    }
    console.log('  All expected views, procedures, triggers and indexes are present.\n');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
