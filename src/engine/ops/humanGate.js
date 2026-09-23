// humanGate: pause until the lead clicks continue in the panel. Never times
// out and never auto-continues.

import { Ok } from '../../shared/result.js';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */

/**
 * @param {OpContext} _ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(_ctx, step) {
  return Ok({ pause: { kind: 'humanGate', message: step.message ?? 'Do the next part yourself, then continue.' } });
}
