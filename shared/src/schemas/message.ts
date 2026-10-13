import { z } from 'zod';

export const messageCreateSchema = z
  .object({
    body: z.string().trim().min(1).max(1000),
  })
  .strict();

export type CreateMessage = z.infer<typeof messageCreateSchema>;

export const messageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeId: z.coerce.number().int().positive().optional(),
});

export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
