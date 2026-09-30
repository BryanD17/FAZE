import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../db/pool.js';
import type { Db } from './user.repo.js';

export interface GameResult {
  id: number;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  genres: string[];
}

interface GameRecord extends RowDataPacket {
  game_id: number;
  title: string;
  cover_url: string | null;
  release_year: number | null;
  genres: string | null;
  score?: number;
}

const mapGame = (r: GameRecord): GameResult => ({
  id: r.game_id,
  title: r.title,
  coverUrl: r.cover_url,
  releaseYear: r.release_year,
  genres: r.genres ? r.genres.split(',') : [],
});

export async function gameExists(gameId: number, db: Db = pool): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT 1 FROM game WHERE game_id = :gameId', {
    gameId,
  });

  return rows.length > 0;
}

export async function searchGamesFulltext(
  query: string,
  platform: string | undefined,
  multiplayerOnly: boolean,
  limit: number,
  cursorScore: number | null,
  cursorId: number | null,
): Promise<Array<GameResult & { score: number }>> {
  const [rows] = await pool.query<GameRecord[]>(
    `SELECT
       g.game_id,
       g.title,
       g.cover_url,
       YEAR(g.release_date) AS release_year,
       (
         SELECT GROUP_CONCAT(ge.name ORDER BY ge.name SEPARATOR ',')
           FROM game_genre gg
           JOIN genre ge ON ge.genre_id = gg.genre_id
          WHERE gg.game_id = g.game_id
       ) AS genres,
       MATCH(g.title) AGAINST (:query IN BOOLEAN MODE) AS score
     FROM game g
     WHERE MATCH(g.title) AGAINST (:query IN BOOLEAN MODE)
       AND (:multiplayerOnly = 0 OR g.is_multiplayer = 1)
       AND (
         :platform IS NULL OR EXISTS (
           SELECT 1
             FROM game_platform gp
             JOIN platform p ON p.platform_id = gp.platform_id
            WHERE gp.game_id = g.game_id
              AND p.slug = :platform
         )
       )
       AND (
         :cursorScore IS NULL
         OR MATCH(g.title) AGAINST (:query IN BOOLEAN MODE) < :cursorScore
         OR (
           MATCH(g.title) AGAINST (:query IN BOOLEAN MODE) = :cursorScore
           AND g.game_id > :cursorId
         )
       )
     ORDER BY score DESC, g.game_id ASC
     LIMIT :limit`,
    {
      query,
      platform: platform ?? null,
      multiplayerOnly: multiplayerOnly ? 1 : 0,
      cursorScore,
      cursorId,
      limit,
    },
  );

  return rows.map((r) => ({
    ...mapGame(r),
    score: Number(r.score ?? 0),
  }));
}

export async function searchGamesPrefix(
  query: string,
  platform: string | undefined,
  multiplayerOnly: boolean,
  limit: number,
  cursorTitle: string | null,
  cursorId: number | null,
): Promise<GameResult[]> {
  const [rows] = await pool.query<GameRecord[]>(
    `SELECT
       g.game_id,
       g.title,
       g.cover_url,
       YEAR(g.release_date) AS release_year,
       (
         SELECT GROUP_CONCAT(ge.name ORDER BY ge.name SEPARATOR ',')
           FROM game_genre gg
           JOIN genre ge ON ge.genre_id = gg.genre_id
          WHERE gg.game_id = g.game_id
       ) AS genres
     FROM game g
     WHERE g.title LIKE CONCAT(:query, '%')
       AND (:multiplayerOnly = 0 OR g.is_multiplayer = 1)
       AND (
         :platform IS NULL OR EXISTS (
           SELECT 1
             FROM game_platform gp
             JOIN platform p ON p.platform_id = gp.platform_id
            WHERE gp.game_id = g.game_id
              AND p.slug = :platform
         )
       )
       AND (
         :cursorTitle IS NULL
         OR g.title > :cursorTitle
         OR (g.title = :cursorTitle AND g.game_id > :cursorId)
       )
     ORDER BY g.title ASC, g.game_id ASC
     LIMIT :limit`,
    {
      query,
      platform: platform ?? null,
      multiplayerOnly: multiplayerOnly ? 1 : 0,
      cursorTitle,
      cursorId,
      limit,
    },
  );

  return rows.map(mapGame);
}

export async function popularGames(limit = 20): Promise<GameResult[]> {
  const [rows] = await pool.query<GameRecord[]>(
    `SELECT
       v.game_id,
       v.title,
       g.cover_url,
       YEAR(g.release_date) AS release_year,
       (
         SELECT GROUP_CONCAT(ge.name ORDER BY ge.name SEPARATOR ',')
           FROM game_genre gg
           JOIN genre ge ON ge.genre_id = gg.genre_id
          WHERE gg.game_id = v.game_id
       ) AS genres
     FROM v_game_popularity v
     JOIN game g ON g.game_id = v.game_id
     ORDER BY
       (v.active_group_count + v.searching_user_count) DESC,
       v.game_id ASC
     LIMIT :limit`,
    { limit },
  );

  return rows.map(mapGame);
}

export interface UserGameResult extends GameResult {
  selfRank: string | null;
  rankTier: number | null;
  hoursPlayed: number | null;
  goal: string;
  isPrimary: boolean;
}

interface UserGameRecord extends GameRecord {
  self_rank: string | null;
  rank_tier: number | null;
  hours_played: number | null;
  goal: string;
  is_primary: number;
}

export async function userGames(userId: number): Promise<UserGameResult[]> {
  const [rows] = await pool.query<UserGameRecord[]>(
    `SELECT
       g.game_id,
       g.title,
       g.cover_url,
       YEAR(g.release_date) AS release_year,
       (
         SELECT GROUP_CONCAT(ge.name ORDER BY ge.name SEPARATOR ',')
           FROM game_genre gg
           JOIN genre ge ON ge.genre_id = gg.genre_id
          WHERE gg.game_id = g.game_id
       ) AS genres,
       ug.self_rank,
       ug.rank_tier,
       ug.hours_played,
       ug.goal,
       ug.is_primary
     FROM user_game ug
     JOIN game g ON g.game_id = ug.game_id
     WHERE ug.user_id = :userId
     ORDER BY ug.is_primary DESC, g.title ASC`,
    { userId },
  );

  return rows.map((r) => ({
    ...mapGame(r),
    selfRank: r.self_rank,
    rankTier: r.rank_tier,
    hoursPlayed: r.hours_played,
    goal: r.goal,
    isPrimary: r.is_primary === 1,
  }));
}
