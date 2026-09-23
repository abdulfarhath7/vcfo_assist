// assert: fail the run with the step's message when the element is absent.

import { Ok, Err } from '../../shared/result.js';
import { selectorsFor } from '../context.js';
import { flag } from '../waits.js';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */

/**
 * @param {OpContext} ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(ctx, step) {
  if (!step.selector) return Err('validation', `assert step "${step.label ?? ''}" has no selector`);
  const r = await ctx.send('exists', { selectors: selectorsFor(step.selector) });
  if (!r.ok) return r;
  if (!flag(r.value, 'found')) {
    return Err('precondition', `${step.message ?? 'Assertion failed'} (\`${step.selector}\` matched 0 elements)`, { selectors: [step.selector], step: step.label });
  }
  return Ok({});
}
