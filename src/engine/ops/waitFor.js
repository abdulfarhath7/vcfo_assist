// waitFor: element present and visible, within the step's timeout.

import { Ok, Err } from '../../shared/result.js';
import { TIMEOUTS } from '../../shared/constants.js';
import { selectorsFor } from '../context.js';
import { slicedWait, flag } from '../waits.js';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */

/**
 * @param {OpContext} ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(ctx, step) {
  if (!step.selector) return Err('validation', `waitFor step "${step.label ?? ''}" has no selector`);
  const selector = step.selector;
  const total = step.timeoutMs ?? TIMEOUTS.WAIT_DEFAULT_MS;
  const r = await slicedWait(
    ctx, 'waitFor', { selectors: selectorsFor(selector), field: step.label ?? '' }, total,
    (v) => flag(v, 'found'),
    () => Err('timeout', `Step "${step.label ?? selector}": \`${selector}\` did not appear within ${total / 1000}s`, { selectors: [selector], step: step.label }),
  );
  if (!r.ok) return r;
  return Ok({});
}
