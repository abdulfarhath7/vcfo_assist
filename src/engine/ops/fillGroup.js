// fillGroup: every field in a map section, in dependsOn-respecting map
// order. Verification mismatches are collected and the group continues;
// after the group, verify.js reads everything back and the resulting Diff
// is merged into the run state.

import { Ok, Err } from '../../shared/result.js';
import { orderedFields } from '../loader.js';
import { fillField } from '../fieldfill.js';
import { verifyFields, mergeDiff } from '../verify.js';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */
/** @typedef {import('../../shared/schema.js').DiffSkip} DiffSkip */

/**
 * @param {OpContext} ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(ctx, step) {
  if (!step.section) return Err('validation', `fillGroup step "${step.label ?? ''}" has no section`);
  if (!(step.section in ctx.fieldMap.sections)) {
    return Err('validation', `fillGroup references section "${step.section}" which the field map lacks`);
  }
  const fields = orderedFields(ctx.fieldMap, step.section);
  /** @type {Map<string, string>} */
  const expectedByKey = new Map();
  /** @type {Map<string, string>} */
  const reasons = new Map();
  /** @type {DiffSkip[]} */
  const skipped = [];
  let written = 0;

  for (const field of fields) {
    if (ctx.abortRequested()) return Err('internal', 'aborted');
    const started = Date.now();
    const outcome = await fillField(ctx, field);
    const ms = Date.now() - started;
    if (!outcome.ok) {
      ctx.log({ op: 'fill', label: field.label, outcome: 'error', ms, note: outcome.error.class });
      return outcome;
    }
    const o = outcome.value;
    if (o.kind === 'skipped') {
      skipped.push({ key: field.key, reason: o.reason });
      ctx.log({ op: 'fill', label: field.label, outcome: 'skipped', ms, note: o.reason });
      continue;
    }
    if (o.kind === 'mismatch') {
      // Keep the expected value so verify reads the field back; keep the
      // reason so the diff explains why it differs.
      if (o.expected !== '') expectedByKey.set(field.key, o.expected);
      reasons.set(field.key, o.reason);
      if (o.expected === '') {
        skipped.push({ key: field.key, reason: o.reason });
      }
      ctx.log({ op: 'fill', label: field.label, outcome: 'error', ms, note: 'mismatch' });
      continue;
    }
    expectedByKey.set(field.key, o.expected);
    written += 1;
    ctx.log({ op: 'fill', label: field.label, outcome: 'ok', ms });
    await ctx.persist();
  }

  const verified = await verifyFields(ctx, fields, expectedByKey, skipped, reasons);
  if (!verified.ok) return verified;
  const diff = verified.value;
  ctx.state.fieldsWritten += Math.min(written, diff.matched);
  ctx.state.diff = mergeDiff(ctx.state.diff, diff);
  return Ok({ note: `${diff.matched}/${diff.checked} verified, ${diff.mismatches.length} mismatch${diff.mismatches.length === 1 ? '' : 'es'}, ${diff.skipped.length} skipped` });
}
