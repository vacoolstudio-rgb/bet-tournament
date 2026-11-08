import { InitialSchema1762603200000 } from './1762603200000-InitialSchema.js';

/**
 * Migrations are listed explicitly rather than globbed: under ESM a glob of
 * compiled `.js` and source `.ts` resolves differently depending on how the
 * process was started, and silently running no migrations is the worst
 * possible outcome of a path mistake.
 */
export const migrations = [InitialSchema1762603200000];
