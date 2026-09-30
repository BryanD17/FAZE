import type { GameSearchQuery } from '@faze/shared';

import { popularGames, searchGamesFulltext, searchGamesPrefix } from '../repositories/game.repo.js';
import { AppError, ErrorCode } from '../errors.js';

interface FulltextCursor {
  score: number;
  id: number;
}

interface PrefixCursor {
  title: string;
  id: number;
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor<T>(cursor?: string): T | null {
  if (!cursor) return null;

  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid pagination cursor.', 'cursor');
  }
}

export const gameService = {
  async search(input: GameSearchQuery) {
    const requestLimit = input.limit + 1;

    if (input.q.length <= 2) {
      const cursor = decodeCursor<PrefixCursor>(input.cursor);

      const rows = await searchGamesPrefix(
        input.q,
        input.platform,
        input.multiplayerOnly,
        requestLimit,
        cursor?.title ?? null,
        cursor?.id ?? null,
      );

      const hasMore = rows.length > input.limit;
      const data = rows.slice(0, input.limit);
      const last = data[data.length - 1];

      return {
        data,
        page: {
          limit: input.limit,
          hasMore,
          nextCursor:
            hasMore && last
              ? encodeCursor({
                  title: last.title,
                  id: last.id,
                })
              : null,
        },
      };
    }

    const fulltextQuery = input.q
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `${term.replace(/[+\-<>()~*"@]/g, '')}*`)
      .join(' ');

    const cursor = decodeCursor<FulltextCursor>(input.cursor);

    const rows = await searchGamesFulltext(
      fulltextQuery,
      input.platform,
      input.multiplayerOnly,
      requestLimit,
      cursor?.score ?? null,
      cursor?.id ?? null,
    );

    const hasMore = rows.length > input.limit;
    const data = rows.slice(0, input.limit);
    const last = data[data.length - 1];

    return {
      data: data.map(({ score: _score, ...game }) => game),
      page: {
        limit: input.limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                score: last.score,
                id: last.id,
              })
            : null,
      },
    };
  },

  popular() {
    return popularGames();
  },
};
