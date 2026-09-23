// check: checkbox or radio, by key. The step may carry an explicit `value`;
// otherwise the Suite value decides.

import { Ok, Err } from '../../shared/result.js';
import { findField } from '../loader.js';
import { fillField, fillFieldWith } from '../fieldfill.js';
import { mergeDiff } from '../verify.js';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */

/**
 * @param {OpContext} ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(ctx, step) {
  if (!step.key) return Err('validation', `check step "${step.label ?? ''}" has no key`);
  const found = findField(ctx.fieldMap, step.key);
  if (!found) return Err('validation', `check step references key "${step.key}" which the field map lacks`, { field: step.key });
  const outcome = step.value === undefined
    ? await fillField(ctx, found.field)
    : await fillFieldWith(ctx, found.field, String(step.value));
  if (!outcome.ok) return outcome;
  const o = outcome.value;
  if (o.kind === 'filled') {
    ctx.state.fieldsWritten += 1;
    ctx.state.diff = mergeDiff(ctx.state.diff, { checked: 1, matched: 1, mismatches: [], skipped: [] });
    return Ok({ note: 'set and verified' });
  }
  if (o.kind === 'skipped') {
    ctx.state.diff = mergeDiff(ctx.state.diff, { checked: 0, matched: 0, mismatches: [], skipped: [{ key: found.field.key, reason: o.reason }] });
    return Ok({ note: `skipped: ${o.reason}` });
  }
  ctx.state.diff = mergeDiff(ctx.state.diff, {
    checked: 1, matched: 0, skipped: [],
    mismatches: [{ key: found.field.key, label: found.field.label, expected: o.expected, actual: o.actual, reason: o.reason }],
  });
  return Ok({ note: 'mismatch recorded' });
}
