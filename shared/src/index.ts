/**
 * @faze/shared — the single source of truth for shapes that cross the wire.
 *
 * Both the Express server and the React client import from here, so a contract
 * change is a compile error on both sides rather than a runtime `undefined`.
 * Runtime validation is zod; the TypeScript types are inferred from the same
 * schemas, so they can never drift apart.
 */
export * from './schemas/common.js';
export * from './schemas/health.js';
