import { z } from 'zod';
import { displayNameSchema } from './auth.js';

export const timezoneSchema = z.string().refine(
  (value) => {
    try {
      return Intl.supportedValuesOf('timeZone').includes(value);
    } catch {
      return value === 'UTC';
    }
  },
  { message: 'Use a valid IANA timezone.' },
);

export const profilePatchSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    bio: z.string().max(500).nullable().optional(),
    avatarUrl: z.string().url().max(500).nullable().optional(),
    birthYear: z.number().int().min(1940).max(2020).nullable().optional(),
    regionId: z.number().int().positive().nullable().optional(),
    languageId: z.number().int().positive().nullable().optional(),
    timezone: timezoneSchema.optional(),
    micAvailable: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one profile field is required.',
  });

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export const platformSetSchema = z
  .object({
    platformIds: z.array(z.number().int().positive()).max(20),
  })
  .strict()
  .transform(({ platformIds }) => ({
    platformIds: [...new Set(platformIds)],
  }));

export type PlatformSet = z.infer<typeof platformSetSchema>;

export const tagSetSchema = z
  .object({
    tagIds: z.array(z.number().int().positive()).max(5),
  })
  .strict()
  .transform(({ tagIds }) => ({
    tagIds: [...new Set(tagIds)],
  }));

export type TagSet = z.infer<typeof tagSetSchema>;

export const gameGoalSchema = z.enum(['casual', 'ranked', 'learning', 'completionist', 'content']);

export const gameLibraryCreateSchema = z
  .object({
    gameId: z.number().int().positive(),
    selfRank: z.string().trim().max(40).nullable().default(null),
    rankTier: z.number().int().min(1).max(10).nullable().default(null),
    hoursPlayed: z.number().int().min(0).max(65535).nullable().default(null),
    goal: gameGoalSchema.default('casual'),
    isPrimary: z.boolean().default(false),
  })
  .strict();

export type GameLibraryCreate = z.infer<typeof gameLibraryCreateSchema>;

export const gameLibraryPatchSchema = z
  .object({
    selfRank: z.string().trim().max(40).nullable().optional(),
    rankTier: z.number().int().min(1).max(10).nullable().optional(),
    hoursPlayed: z.number().int().min(0).max(65535).nullable().optional(),
    goal: gameGoalSchema.optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one game field is required.',
  });

export type GameLibraryPatch = z.infer<typeof gameLibraryPatchSchema>;

const hhmmSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM in 24-hour time.');

const endHhmmSchema = z
  .string()
  .regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use HH:MM in 24-hour time.');

export const availabilitySlotSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startLocal: hhmmSchema,
    endLocal: endHhmmSchema,
  })
  .strict()
  .refine((slot) => slot.startLocal !== slot.endLocal, {
    message: 'Availability slot cannot have zero duration.',
  });

export const availabilitySetSchema = z.array(availabilitySlotSchema).max(50);

export type LocalAvailabilitySlot = z.infer<typeof availabilitySlotSchema>;

export const gameSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(30).optional(),
  multiplayerOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export type GameSearchQuery = z.infer<typeof gameSearchQuerySchema>;
