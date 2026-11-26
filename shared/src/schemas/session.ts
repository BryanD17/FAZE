import { z } from 'zod';

export const scheduleSessionSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ScheduleSession = z.infer<typeof scheduleSessionSchema>;

export const ratingCreateSchema = z
  .object({
    rateeUserId: z.number().int().positive(),
    score: z.number().int().min(1).max(5),
  })
  .strict();

export type CreateRating = z.infer<typeof ratingCreateSchema>;
