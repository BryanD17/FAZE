import type { RequestHandler } from 'express';
import { AppError, ErrorCode } from '../errors.js';
import type { GroupRole } from '../repositories/membership.repo.js';
import { findActiveRole } from '../repositories/membership.repo.js';
import { asyncHandler } from './asyncHandler.js';

const RANK: Record<GroupRole, number> = { member: 1, moderator: 2, owner: 3 };

/**
 * Requires the caller to be an ACTIVE member of the group in `req.params[param]`
 * with at least `minRole`. Must run after requireAuth.
 *
 * A non-member and an under-privileged member get the identical 403, so this
 * guard cannot be used to probe which groups exist or who belongs to them.
 * The role is attached as `req.groupRole` for the handler to use.
 */
export function requireGroupRole(minRole: GroupRole, param = 'id'): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Sign in to continue.');
    const groupId = Number(req.params[param]);
    const role =
      Number.isInteger(groupId) && groupId > 0
        ? await findActiveRole(groupId, req.user.userId)
        : null;
    if (!role || RANK[role] < RANK[minRole]) {
      throw new AppError(
        ErrorCode.FORBIDDEN_GROUP_ROLE,
        403,
        'You do not have permission to do that in this group.',
      );
    }
    req.groupRole = role;
    next();
  });
}
