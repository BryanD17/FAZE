import type {
  GameLibraryCreate,
  GameLibraryPatch,
  LocalAvailabilitySlot,
  ProfilePatch,
} from '@faze/shared';
import {
  localAvailabilityToUtc,
  summarizeAvailability,
  utcAvailabilityToLocal,
} from '@faze/shared';

import { withTransaction } from '../db/pool.js';
import { AppError, ErrorCode } from '../errors.js';
import { gameExists, userGames } from '../repositories/game.repo.js';
import {
  clearPrimaryGame,
  deleteUserGame,
  getAvailability,
  getCompletenessCounts,
  getProfile,
  getProfileByDisplayName,
  hasUserGame,
  patchProfile,
  patchUserGame,
  replaceAvailability,
  replacePlatforms,
  replaceTags,
  setPrimaryGame,
  sharesActiveGroup,
  upsertUserGame,
  userGameCount,
} from '../repositories/profile.repo.js';

function mapDuplicate(error: unknown): never {
  const e = error as { code?: string; message?: string };

  if (e.code === 'ER_DUP_ENTRY' && e.message?.includes('uq_profile_display_name')) {
    throw new AppError(
      ErrorCode.DISPLAY_NAME_TAKEN,
      409,
      'That display name is already in use.',
      'displayName',
    );
  }

  throw error;
}

function invalidReference(field: string, message: string): never {
  throw new AppError('INVALID_REFERENCE', 422, message, field);
}

function ageBracket(birthYear: number | null): string | null {
  if (birthYear === null) return null;

  const age = new Date().getUTCFullYear() - birthYear;

  if (age < 18) return 'under-18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  return '45+';
}

export const profileService = {
  async me(userId: number) {
    const profile = await getProfile(userId);

    if (!profile) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Profile not found.');
    }

    return profile;
  },

  async update(userId: number, input: ProfilePatch) {
    try {
      await patchProfile(userId, input);
    } catch (error) {
      mapDuplicate(error);
    }

    return this.me(userId);
  },

  async setPlatforms(userId: number, platformIds: number[]) {
    try {
      await withTransaction((conn) => replacePlatforms(userId, platformIds, conn));
    } catch (error) {
      if ((error as Error).message === 'UNKNOWN_PLATFORM') {
        invalidReference('platformIds', 'One or more platform IDs do not exist.');
      }
      throw error;
    }

    return this.me(userId);
  },

  async setTags(userId: number, tagIds: number[]) {
    if (tagIds.length > 5) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'Choose at most 5 playstyle tags.',
        'tagIds',
      );
    }

    try {
      await withTransaction((conn) => replaceTags(userId, tagIds, conn));
    } catch (error) {
      if ((error as Error).message === 'UNKNOWN_TAG') {
        invalidReference('tagIds', 'One or more playstyle tag IDs do not exist.');
      }
      throw error;
    }

    return this.me(userId);
  },

  async addGame(userId: number, input: GameLibraryCreate) {
    if (!(await gameExists(input.gameId))) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Game not found.', 'gameId');
    }

    const alreadyExists = await hasUserGame(userId, input.gameId);

    if (!alreadyExists && (await userGameCount(userId)) >= 25) {
      throw new AppError(
        'GAME_LIBRARY_LIMIT',
        422,
        'A profile may contain at most 25 games.',
        'gameId',
      );
    }

    await upsertUserGame(userId, {
      gameId: input.gameId,
      selfRank: input.selfRank,
      rankTier: input.rankTier,
      hoursPlayed: input.hoursPlayed,
      goal: input.goal,
    });

    if (input.isPrimary) {
      await setPrimaryGame(userId, input.gameId);
    } else {
      await clearPrimaryGame(userId, input.gameId);
    }

    return userGames(userId);
  },

  async updateGame(userId: number, gameId: number, input: GameLibraryPatch) {
    if (!(await hasUserGame(userId, gameId))) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Game is not in your library.');
    }

    const { isPrimary, ...patch } = input;

    await patchUserGame(userId, gameId, patch);

    if (isPrimary === true) {
      await setPrimaryGame(userId, gameId);
    } else if (isPrimary === false) {
      await clearPrimaryGame(userId, gameId);
    }

    return userGames(userId);
  },

  async removeGame(userId: number, gameId: number) {
    const affected = await deleteUserGame(userId, gameId);

    if (affected === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Game is not in your library.');
    }
  },

  async games(userId: number) {
    return userGames(userId);
  },

  async setAvailability(userId: number, input: LocalAvailabilitySlot[]) {
    const profile = await getProfile(userId);

    if (!profile) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Profile not found.');
    }

    let utc;

    try {
      utc = localAvailabilityToUtc(input, profile.timezone);
    } catch (error) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, (error as Error).message, 'availability');
    }

    await withTransaction((conn) => replaceAvailability(userId, utc, conn));

    return this.availability(userId);
  },

  async availability(userId: number) {
    const profile = await getProfile(userId);

    if (!profile) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Profile not found.');
    }

    const utc = await getAvailability(userId);

    return {
      timezone: profile.timezone,
      local: utcAvailabilityToLocal(utc, profile.timezone),
      utc,
    };
  },

  async publicProfile(displayName: string, viewerId: number | null) {
    const profile = await getProfileByDisplayName(displayName);

    if (!profile) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Profile not found.');
    }

    const exactAvailability =
      viewerId !== null &&
      (viewerId === profile.userId || (await sharesActiveGroup(viewerId, profile.userId)));

    const utc = await getAvailability(profile.userId);
    const local = utcAvailabilityToLocal(utc, profile.timezone);

    return {
      userId: profile.userId,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      ageBracket: ageBracket(profile.birthYear),
      regionCode: profile.regionCode,
      languageCode: profile.languageCode,
      timezone: profile.timezone,
      micAvailable: profile.micAvailable,
      platforms: profile.platforms,
      tags: profile.tags,
      primaryGameId: profile.primaryGameId,
      availability: exactAvailability ? { local, utc } : null,
      availabilitySummary: exactAvailability ? null : summarizeAvailability(local),
    };
  },

  async completeness(userId: number) {
    const c = await getCompletenessCounts(userId);

    const missing: string[] = [];

    if (c.platforms === 0) missing.push('platforms');
    if (c.games === 0) missing.push('games');
    if (c.region === 0) missing.push('region');
    if (c.availability === 0) missing.push('availability');
    if (c.tags === 0) missing.push('tags');

    return {
      score: (5 - missing.length) * 20,
      missing,
    };
  },
};
