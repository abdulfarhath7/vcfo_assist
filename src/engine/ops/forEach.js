// forEach never runs: engine/expand.js replaces it with one copy of its steps
// per payload row before a run starts. Reaching this op means a recipe was run
// without expansion, which is an engine bug, and the run stops loudly.

import { Err } from '../../shared/result.js';

/**
 * @param {import('../context.js').OpContext} _ctx
 * @param {import('../../shared/schema.js').Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(_ctx, step) {
  return Err('internal', `forEach "${step.label ?? step.over ?? ''}" reached the runner unexpanded. This is an engine bug; nothing was filled for it.`);
}
