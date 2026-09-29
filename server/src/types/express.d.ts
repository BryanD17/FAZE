import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requireAuth from a verified access token. */
    user?: { userId: number; displayName: string };
    /** Set by requireGroupRole: the caller's active role in the group being accessed. */
    groupRole?: 'owner' | 'moderator' | 'member';
  }
}
