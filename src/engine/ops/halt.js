// halt: end the run cleanly. Always the last step of a fill recipe. The run
// stops here; what follows (review, DSC, payment, submission) is the human's.

import { Ok } from '../../shared/result.js';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */

/**
 * @param {OpContext} _ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(_ctx, step) {
  return Ok({ halt: step.reason ?? 'Review every field, then submit yourself.' });
}
