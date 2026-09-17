import { z } from 'zod';

/**
 * The one error envelope every FAZE endpoint uses on failure (AGENT 09 freezes
 * the full code list; the shape is fixed here from day one so no route invents
 * its own). `field` lets the client highlight the offending input.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'error codes are SCREAMING_SNAKE'),
    message: z.string(),
    field: z.string().nullable().default(null),
    details: z.record(z.unknown()).nullable().default(null),
    requestId: z.string().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** Pagination is keyset-only across the whole API — never OFFSET (anti-pattern C5). */
export const pageMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  limit: z.number().int().positive().max(50),
  hasMore: z.boolean(),
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

/** Wraps any list response as `{ data, page }`. Single resources return bare objects. */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), page: pageMetaSchema });

/** Shared query params for every list endpoint. */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
