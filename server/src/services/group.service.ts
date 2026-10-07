import type { CreateGroup, GroupListQuery } from '@faze/shared';
import { GROUP_PAGE_SIZE } from '@faze/shared';

import { AppError, ErrorCode } from '../errors.js';
import {
  checkReferences,
  createGroup,
  getGroup,
  groupIsLive,
  joinGroup,
  leaveGroup,
  listGroups,
} from '../repositories/group.repo.js';
import { findActiveRole } from '../repositories/membership.repo.js';

function groupNotFound(): never {
  throw new AppError(ErrorCode.GROUP_NOT_FOUND, 404, 'That group does not exist.');
}

function invalidReference(field: string, message: string): never {
  throw new AppError(ErrorCode.INVALID_REFERENCE, 422, message, field);
}

/** A malformed :id is a bad request, not a missing group. */
export function parseGroupId(raw: string | undefined): number {
  const id = Number(raw);
  if (!/^\d+$/.test(raw ?? '') || !Number.isSafeInteger(id) || id <= 0) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      400,
      'Group id must be a positive integer.',
      'id',
    );
  }
  return id;
}

export const groupService = {
  async list(query: GroupListQuery) {
    const { page, ...filters } = query;
    const rows = await listGroups(filters, GROUP_PAGE_SIZE + 1, (page - 1) * GROUP_PAGE_SIZE);
    return {
      groups: rows.slice(0, GROUP_PAGE_SIZE),
      page,
      hasMore: rows.length > GROUP_PAGE_SIZE,
    };
  },

  async detail(groupId: number, viewerId: number) {
    const group = await getGroup(groupId);
    if (!group) groupNotFound();
    return { ...group, myRole: await findActiveRole(groupId, viewerId) };
  },

  async create(ownerId: number, input: CreateGroup) {
    const refs = await checkReferences(input);
    if (refs.gameIsMultiplayer === null) invalidReference('gameId', 'That game does not exist.');
    if (!refs.gameIsMultiplayer) invalidReference('gameId', 'That game is not multiplayer.');
    if (!refs.regionExists) invalidReference('regionId', 'That region does not exist.');
    if (!refs.languageExists) invalidReference('languageId', 'That language does not exist.');
    if (refs.platformCount !== input.platformIds.length) {
      invalidReference('platformIds', 'One or more platform IDs do not exist.');
    }

    const groupId = await createGroup(ownerId, input);
    return groupService.detail(groupId, ownerId);
  },

  async join(userId: number, groupId: number) {
    if (!(await groupIsLive(groupId))) groupNotFound();
    const result = await joinGroup(userId, groupId);
    switch (result) {
      case 'JOINED':
        return { result };
      case 'NOT_FOUND':
        return groupNotFound();
      case 'FULL':
        throw new AppError(ErrorCode.GROUP_FULL, 409, 'This group is full.');
      case 'ALREADY_MEMBER':
        throw new AppError(ErrorCode.ALREADY_MEMBER, 409, 'You are already in this group.');
      default:
        throw new AppError(result, 409, result);
    }
  },

  async leave(userId: number, groupId: number) {
    if (!(await groupIsLive(groupId))) groupNotFound();
    const result = await leaveGroup(userId, groupId);
    if (result === 'NOT_A_MEMBER') groupNotFound();
    return { result };
  },
};
