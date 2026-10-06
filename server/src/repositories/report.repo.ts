import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../db/pool.js';
import type { Db } from './user.repo.js';

export interface PopularGame {
  gameId: number;
  title: string;
  activeGroups: number;
  searchingUsers: number;
}

export interface SummaryReport {
  totals: {
    users: number;
    games: number;
    groups: number;
    activeMembers: number;
    messages: number;
  };
  /** Groups whose stored member_count differs from the real count. Must be 0. */
  memberCountDrift: number;
  /** Most active multiplayer games, from the v_game_popularity view. */
  popularGames: PopularGame[];
}

interface TotalsRecord extends RowDataPacket {
  users: number;
  games: number;
  group_total: number;
  active_members: number;
  messages: number;
  drift: number;
}

interface PopularRecord extends RowDataPacket {
  game_id: number;
  title: string;
  active_group_count: number;
  searching_user_count: number;
}

/**
 * Plain counts plus the ten most active games: a read-only snapshot for one
 * "database stats" page. The data comes from the base tables and two of the
 * views (`v_member_count_reconciliation`, `v_game_popularity`), so it shows what
 * those views are for. The popularity view is the slow part (~0.3 s on 118,001
 * games), which is fine for a page nobody refreshes in a loop.
 */
export async function getSummary(db: Db = pool): Promise<SummaryReport> {
  const [[totals]] = await db.query<TotalsRecord[]>(
    `SELECT
       (SELECT COUNT(*) FROM \`user\`) AS users,
       (SELECT COUNT(*) FROM game) AS games,
       (SELECT COUNT(*) FROM lfg_group) AS group_total,
       (SELECT COUNT(*) FROM group_member WHERE state = 'active') AS active_members,
       (SELECT COUNT(*) FROM message) AS messages,
       (SELECT COUNT(*) FROM v_member_count_reconciliation WHERE drift <> 0) AS drift`,
  );

  const [popular] = await db.query<PopularRecord[]>(
    `SELECT game_id, title, active_group_count, searching_user_count
       FROM v_game_popularity
      ORDER BY active_group_count DESC, searching_user_count DESC, title
      LIMIT 10`,
  );

  return {
    totals: {
      users: totals!.users,
      games: totals!.games,
      groups: totals!.group_total,
      activeMembers: totals!.active_members,
      messages: totals!.messages,
    },
    memberCountDrift: totals!.drift,
    popularGames: popular.map((r) => ({
      gameId: r.game_id,
      title: r.title,
      activeGroups: r.active_group_count,
      searchingUsers: r.searching_user_count,
    })),
  };
}
