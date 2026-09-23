// Op registry. One file per op; the runner dispatches by `step.op`. There is
// deliberately no `submit` entry and no way to add one from a recipe.

import * as click from './click.js';
import * as fill from './fill.js';
import * as fillGroup from './fillGroup.js';
import * as select from './select.js';
import * as check from './check.js';
import * as waitFor from './waitFor.js';
import * as waitForGone from './waitForGone.js';
import * as waitForUrl from './waitForUrl.js';
import * as assert from './assert.js';
import * as humanGate from './humanGate.js';
import * as halt from './halt.js';

/**
 * @typedef {(ctx: import('../context.js').OpContext, step: import('../../shared/schema.js').Step) => Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>} OpRunner
 */

/** @type {Readonly<Record<import('../../shared/schema.js').StepOp, OpRunner>>} */
export const OPS = Object.freeze({
  click: click.run,
  fill: fill.run,
  fillGroup: fillGroup.run,
  select: select.run,
  check: check.run,
  waitFor: waitFor.run,
  waitForGone: waitForGone.run,
  waitForUrl: waitForUrl.run,
  assert: assert.run,
  humanGate: humanGate.run,
  halt: halt.run,
});
