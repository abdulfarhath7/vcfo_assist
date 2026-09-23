// click: inspect the target, run it past the guard, then click. The content
// script re-checks the danger set with the same patterns right before the
// click, so the guard holds even if the element changed between the two
// messages.

import { Ok, Err } from '../../shared/result.js';
import { selectorsFor } from '../context.js';
import { checkClickTarget, dangerPatternSet } from '../guard.js';
import { TIMEOUTS } from '../../shared/constants.js';
import { slicedWait, flag } from '../waits.js';

/** Marks the optional-click wait running out, as opposed to a transport timeout. */
const NOT_SHOWN = 'optional click target not shown';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */

/**
 * @param {OpContext} ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(ctx, step) {
  if (!step.selector) return Err('validation', `click step "${step.label ?? ''}" has no selector`);
  const label = step.label ?? step.selector;
  const selectors = selectorsFor(step.selector);

  // Optional: a control the portal shows only sometimes (an info pop-up).
  // Absent after the wait is not a failure; present, it faces the guard as usual.
  if (step.optional) {
    const total = step.timeoutMs ?? TIMEOUTS.OPTIONAL_CLICK_MS;
    const seen = await slicedWait(
      ctx, 'waitFor', { selectors, field: label }, total,
      (v) => flag(v, 'found'),
      () => Err('timeout', NOT_SHOWN),
    );
    if (!seen.ok) {
      if (seen.error.class === 'timeout' && seen.error.message === NOT_SHOWN) return Ok({ note: `not shown within ${total / 1000}s; continued` });
      return seen;
    }
  }

  const inspected = await ctx.send('inspect', { selectors, field: label });
  if (!inspected.ok) return inspected;
  const descriptor = /** @type {{ descriptor: import('../../shared/schema.js').ElementDescriptor, selector: string }} */ (inspected.value);
  const allowed = checkClickTarget(descriptor.descriptor, descriptor.selector, label);
  if (!allowed.ok) return allowed;

  const clicked = await ctx.send('click', { selectors, field: label, danger: dangerPatternSet() });
  if (!clicked.ok) return clicked;
  return Ok({});
}
