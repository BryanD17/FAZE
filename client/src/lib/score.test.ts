import { describe, expect, it } from 'vitest';
import { scoreParts } from './score.ts';

// The worked example in docs/matchmaking.md, split back into its parts.
describe('scoreParts', () => {
  it('splits a full match into 50 + 20 + free time', () => {
    expect(scoreParts({ score: 76, sameGame: true, sameRegion: true })).toEqual({
      game: 50,
      region: 20,
      freeTime: 6,
    });
  });

  it('caps free time at 30', () => {
    expect(scoreParts({ score: 80, sameGame: true, sameRegion: false })).toEqual({
      game: 50,
      region: 0,
      freeTime: 30,
    });
  });

  it('gives a region-only match no game or free-time points', () => {
    expect(scoreParts({ score: 20, sameGame: false, sameRegion: true })).toEqual({
      game: 0,
      region: 20,
      freeTime: 0,
    });
  });

  it('never returns a negative part', () => {
    expect(scoreParts({ score: 49, sameGame: true, sameRegion: false }).freeTime).toBe(0);
  });
});
