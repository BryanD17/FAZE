/**
 * Group SQL. Reads come from v_group_card; every write is one of the three
 * stored procedures (0008), which own capacity checks and owner succession.
 * member_count and status are maintained by triggers (0009) and only read here.
 */
import type { RowDataPacket } from 'mysql2/promise';
import type { CreateGroup } from '@faze/shared';

import { pool } from '../db/pool.js';
import type { GroupRole } from './membership.repo.js';
import type { Db } from './user.repo.js';

export interface GroupCard {
  groupId: number;
  title: string;
  gameId: number;
  gameTitle: string;
  gameCoverUrl: string | null;
  regionCode: string | null;
  ownerDisplayName: string;
  memberCount: number;
  maxMembers: number;
  openSlots: number;
  platforms: string[];
  status: string;
  createdAt: Date;
}

export interface GroupMember {
  displayName: string;
  role: GroupRole;
  joinedAt: Date;
}

export interface GroupDetail extends GroupCard {
  description: string | null;
  languageCode: string | null;
  regionName: string | null;
  members: GroupMember[];
}

export interface GroupFilters {
  gameId?: number;
  platformId?: number;
  regionId?: number;
}

interface CardRecord extends RowDataPacket {
  group_id: number;
  title: string;
  game_id: number;
  game_title: string;
  game_cover_url: string | null;
  region_code: string | null;
  owner_display_name: string;
  member_count: number;
  max_members: number;
  open_slots: number;
  platform_slugs: string | null;
  status: string;
  created_at: Date;
}

interface DetailRecord extends CardRecord {
  description: string | null;
  language_code: string | null;
  region_name: string | null;
}

const CARD_COLUMNS = `g.group_id, g.title, g.game_id, g.game_title, g.game_cover_url, g.region_code,
       g.owner_display_name, g.member_count, g.max_members, g.open_slots, g.platform_slugs,
       g.status, g.created_at`;

function toCard(r: CardRecord): GroupCard {
  return {
    groupId: r.group_id,
    title: r.title,
    gameId: r.game_id,
    gameTitle: r.game_title,
    gameCoverUrl: r.game_cover_url,
    regionCode: r.region_code,
    ownerDisplayName: r.owner_display_name,
    memberCount: r.member_count,
    maxMembers: r.max_members,
    openSlots: r.open_slots,
    platforms: r.platform_slugs ? r.platform_slugs.split(',') : [],
    status: r.status,
    createdAt: r.created_at,
  };
}

export interface ReferenceCheck {
  /** null when the game does not exist. */
  gameIsMultiplayer: boolean | null;
  regionExists: boolean;
  languageExists: boolean;
  /** How many of the given platform ids exist. */
  platformCount: number;
}

/** Every id a new group points at, checked in one round trip. */
export async function checkReferences(
  input: Pick<CreateGroup, 'gameId' | 'regionId' | 'languageId' | 'platformIds'>,
  db: Db = pool,
): Promise<ReferenceCheck> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT (SELECT is_multiplayer FROM game WHERE game_id = :gameId) AS game_multiplayer,
            EXISTS (SELECT 1 FROM region WHERE region_id = :regionId) AS region_exists,
            EXISTS (SELECT 1 FROM \`language\` WHERE language_id = :languageId) AS language_exists,
            (SELECT COUNT(*) FROM platform WHERE platform_id IN (:platformIds)) AS platform_count`,
    input,
  );
  const r = rows[0]!;
  return {
    gameIsMultiplayer: r.game_multiplayer === null ? null : r.game_multiplayer === 1,
    regionExists: r.region_exists === 1,
    languageExists: r.language_exists === 1,
    platformCount: Number(r.platform_count),
  };
}

/**
 * Creates an open group through sp_create_group (which also adds the owner as
 * an active member). The OUT parameter is a session variable, so the CALL and
 * the SELECT that reads it must share one connection.
 */
export async function createGroup(ownerUserId: number, input: CreateGroup): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `CALL sp_create_group(:ownerUserId, :gameId, :title, :description, :regionId, :languageId,
                            'open', :maxMembers, 0, NULL, NULL, NULL, :platformCsv, @group_id)`,
      { ...input, ownerUserId, platformCsv: input.platformIds.join(',') },
    );
    const [rows] = await conn.query<RowDataPacket[]>('SELECT @group_id AS group_id');
    return Number(rows[0]!.group_id);
  } finally {
    conn.release();
  }
}

/** One page of non-archived groups, newest first. Fetches one extra row to tell if more exist. */
export async function listGroups(
  filters: GroupFilters,
  limit: number,
  offset: number,
  db: Db = pool,
): Promise<GroupCard[]> {
  const conditions = ["g.status <> 'archived'"];
  if (filters.gameId !== undefined) conditions.push('g.game_id = :gameId');
  if (filters.regionId !== undefined) conditions.push('g.region_id = :regionId');
  if (filters.platformId !== undefined) {
    conditions.push(
      'EXISTS (SELECT 1 FROM group_platform gp WHERE gp.group_id = g.group_id AND gp.platform_id = :platformId)',
    );
  }

  const [rows] = await db.query<CardRecord[]>(
    `SELECT ${CARD_COLUMNS}
       FROM v_group_card g
      WHERE ${conditions.join(' AND ')}
      ORDER BY g.created_at DESC, g.group_id DESC
      LIMIT :limit OFFSET :offset`,
    { ...filters, limit, offset },
  );
  return rows.map(toCard);
}

/** The card plus description, language, region name and active members. Null if missing or archived. */
export async function getGroup(groupId: number, db: Db = pool): Promise<GroupDetail | null> {
  const [rows] = await db.query<DetailRecord[]>(
    `SELECT ${CARD_COLUMNS}, lg.description, l.iso_code AS language_code, r.name AS region_name
       FROM v_group_card g
       JOIN lfg_group lg       ON lg.group_id = g.group_id
       LEFT JOIN \`language\` l ON l.language_id = lg.language_id
       LEFT JOIN region r      ON r.region_id = g.region_id
      WHERE g.group_id = :groupId AND g.status <> 'archived'`,
    { groupId },
  );
  const row = rows[0];
  if (!row) return null;

  const [members] = await db.query<RowDataPacket[]>(
    `SELECT p.display_name, gm.role, gm.joined_at
       FROM group_member gm
       JOIN profile p ON p.user_id = gm.user_id
      WHERE gm.group_id = :groupId AND gm.state = 'active'
      ORDER BY gm.joined_at, gm.user_id`,
    { groupId },
  );

  return {
    ...toCard(row),
    description: row.description,
    languageCode: row.language_code,
    regionName: row.region_name,
    members: members.map((m) => ({
      displayName: m.display_name as string,
      role: m.role as GroupRole,
      joinedAt: m.joined_at as Date,
    })),
  };
}

/** True when the group exists and is not archived. */
export async function groupIsLive(groupId: number, db: Db = pool): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM lfg_group WHERE group_id = :groupId AND status <> 'archived'`,
    { groupId },
  );
  return rows.length > 0;
}

async function callMembershipProcedure(
  procedure: 'sp_join_group' | 'sp_leave_group',
  userId: number,
  groupId: number,
): Promise<string> {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CALL ${procedure}(:userId, :groupId, @result)`, { userId, groupId });
    const [rows] = await conn.query<RowDataPacket[]>('SELECT @result AS result');
    return String(rows[0]!.result);
  } finally {
    conn.release();
  }
}

/** sp_join_group's result code: JOINED, FULL, ALREADY_MEMBER, NOT_FOUND, ... */
export function joinGroup(userId: number, groupId: number): Promise<string> {
  return callMembershipProcedure('sp_join_group', userId, groupId);
}

/** sp_leave_group's result code: LEFT_MEMBER_REMAINS, LEFT_SUCCESSOR_PROMOTED, LEFT_GROUP_ARCHIVED, NOT_A_MEMBER. */
export function leaveGroup(userId: number, groupId: number): Promise<string> {
  return callMembershipProcedure('sp_leave_group', userId, groupId);
}
