// waitForUrl: the tab's URL matches the pattern, within the step's timeout.

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
  if (!step.pattern) return Err('validation', `waitForUrl step "${step.label ?? ''}" has no pattern`);
  const pattern = step.pattern;
  const total = step.timeoutMs ?? TIMEOUTS.WAIT_DEFAULT_MS;
  const r = await slicedWait(
    ctx, 'waitForUrl', { pattern }, total,
    (v) => flag(v, 'matched'),
    () => Err('timeout', `Step "${step.label ?? pattern}": URL did not match /${pattern}/ within ${total / 1000}s`, { step: step.label }),
  );
  if (!r.ok) return r;
  return Ok({});
}
