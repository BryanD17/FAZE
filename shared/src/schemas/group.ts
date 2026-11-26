import { z } from 'zod';

export const GROUP_PAGE_SIZE = 20;
export const GROUP_MIN_MEMBERS = 2;
export const GROUP_MAX_MEMBERS = 10;

export const createGroupSchema = z
  .object({
    gameId: z.number().int().positive(),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(1000).nullable().default(null),
    regionId: z.number().int().positive(),
    languageId: z.number().int().positive(),
    maxMembers: z.number().int().min(GROUP_MIN_MEMBERS).max(GROUP_MAX_MEMBERS),
    platformIds: z.array(z.number().int().positive()).min(1).max(10),
  })
  .strict()
  .transform((body) => ({ ...body, platformIds: [...new Set(body.platformIds)] }));

export type CreateGroup = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    maxMembers: z.number().int().min(GROUP_MIN_MEMBERS).max(GROUP_MAX_MEMBERS).optional(),
    close: z.literal(true).optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Change at least one group field.',
  });

export type UpdateGroup = z.infer<typeof updateGroupSchema>;

export const groupListQuerySchema = z.object({
  gameId: z.coerce.number().int().positive().optional(),
  platformId: z.coerce.number().int().positive().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type GroupListQuery = z.infer<typeof groupListQuerySchema>;
