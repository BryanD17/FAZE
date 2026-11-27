import type { MatchCard } from './types.ts';

/** The three parts of the match score and their maximums (see docs/matchmaking.md). */
export const SCORE_MAX = { game: 50, region: 20, freeTime: 30 } as const;

export type ScoreParts = { game: number; region: number; freeTime: number };

/**
 * Split a match score into its game, region and free-time parts.
 *
 * Game and region are all-or-nothing. Free time is whatever is left of the
 * (rounded) total, so the three parts always add up to the score shown on the
 * card, clamped to 0–30 in case of rounding at the edges. (Recomputing it from
 * `overlapHours` could be off by one from the total, because the server
 * rounds the total and the hours separately.)
 */
export function scoreParts(
  match: Pick<MatchCard, 'score' | 'sameGame' | 'sameRegion'>,
): ScoreParts {
  const game = match.sameGame ? SCORE_MAX.game : 0;
  const region = match.sameRegion ? SCORE_MAX.region : 0;
  const freeTime = Math.min(SCORE_MAX.freeTime, Math.max(0, match.score - game - region));
  return { game, region, freeTime };
}
