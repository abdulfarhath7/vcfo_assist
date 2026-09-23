// waitForGone: loader disappeared, within the step's timeout.

import { Ok, Err } from '../../shared/result.js';
import { TIMEOUTS } from '../../shared/constants.js';
import { slicedWait, flag } from '../waits.js';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */

/**
 * @param {OpContext} ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(ctx, step) {
  if (!step.selector) return Err('validation', `waitForGone step "${step.label ?? ''}" has no selector`);
  const selector = step.selector;
  const total = step.timeoutMs ?? TIMEOUTS.WAIT_DEFAULT_MS;
  const r = await slicedWait(
    ctx, 'waitForGone', { selector }, total,
    (v) => flag(v, 'gone'),
    () => Err('timeout', `Step "${step.label ?? selector}": \`${selector}\` was still visible after ${total / 1000}s`, { selectors: [selector], step: step.label }),
  );
  if (!r.ok) return r;
  return Ok({});
}
