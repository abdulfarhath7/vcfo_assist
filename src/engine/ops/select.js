// select: a choice field, by key. Native select or ARIA listbox per the
// map's entry.mode; the shared field flow decides which.

import { run as fillRun } from './fill.js';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */

/**
 * @param {OpContext} ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export function run(ctx, step) {
  return fillRun(ctx, { ...step, op: 'fill' });
}
