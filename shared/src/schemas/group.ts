import { z } from 'zod';

export const GROUP_PAGE_SIZE = 20;

export const createGroupSchema = z
  .object({
    gameId: z.number().int().positive(),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(1000).nullable().default(null),
    regionId: z.number().int().positive(),
    languageId: z.number().int().positive(),
    maxMembers: z.number().int().min(2).max(10),
    platformIds: z.array(z.number().int().positive()).min(1).max(10),
  })
  .strict()
  .transform((body) => ({ ...body, platformIds: [...new Set(body.platformIds)] }));

export type CreateGroup = z.infer<typeof createGroupSchema>;

export const groupListQuerySchema = z.object({
  gameId: z.coerce.number().int().positive().optional(),
  platformId: z.coerce.number().int().positive().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type GroupListQuery = z.infer<typeof groupListQuerySchema>;
