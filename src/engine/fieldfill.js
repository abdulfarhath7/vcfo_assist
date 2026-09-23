// One field, end to end: value lookup, credential guard, dependency settle,
// framework-aware set, MAIN-world jQuery trigger, read-back, and exactly one
// re-attempt on a mismatch. Shared by the fill, fillGroup, select and check
// ops so every field goes through the same door.

import { Ok, Err } from '../shared/result.js';
import { TIMEOUTS } from '../shared/constants.js';
import { checkFieldIsNotCredential, credentialPatternSet } from './guard.js';
import { valuesMatch, readValue } from './verify.js';

/** @typedef {import('../shared/schema.js').FieldDef} FieldDef */
/** @typedef {import('../shared/schema.js').DiffMismatch} DiffMismatch */
/** @typedef {import('./context.js').OpContext} OpContext */

/**
 * Per-field outcome. Hard failures (resolution, ambiguity, timeout,
 * credential, transport) are returned as Err and stop the run; the three
 * kinds here all let the group continue.
 * @typedef {{ kind: 'filled', expected: string, actual: string }
 *   | { kind: 'skipped', reason: string }
 *   | { kind: 'mismatch', expected: string, actual: string, reason: string }} FieldOutcome
 */

/**
 * Wait out the dependent control after its sources changed: the declared
 * loader disappearing, or a quiet period when none is declared.
 * @param {OpContext} ctx
 * @param {FieldDef} field
 * @returns {Promise<import('../shared/result.js').Result<true>>}
 */
export async function settleDependencies(ctx, field) {
  if (field.dependsOn.length === 0) return Ok(true);
  if (field.loadingSelector) {
    const total = TIMEOUTS.WAIT_DEFAULT_MS;
    let elapsed = 0;
    while (elapsed < total) {
      const slice = Math.min(TIMEOUTS.WAIT_SLICE_MS, total - elapsed);
      const r = await ctx.send('waitForGone', { selector: field.loadingSelector, timeoutMs: slice }, slice + TIMEOUTS.SLICE_MARGIN_MS);
      if (!r.ok) return r;
      if (typeof r.value === 'object' && r.value !== null && /** @type {{ gone?: unknown }} */ (r.value).gone === true) return Ok(true);
      elapsed += slice;
      if (ctx.abortRequested()) return Err('internal', 'aborted');
    }
    return Err('timeout',
      `field \`${field.key}\`: loading indicator \`${field.loadingSelector}\` still visible after ${total / 1000}s`,
      { field: field.key, selectors: [field.loadingSelector], elapsedMs: total });
  }
  const r = await ctx.send('settle', { quietMs: TIMEOUTS.SETTLE_QUIET_MS, maxMs: TIMEOUTS.SETTLE_MAX_MS }, TIMEOUTS.SETTLE_MAX_MS + TIMEOUTS.SLICE_MARGIN_MS);
  if (!r.ok) return r;
  return Ok(true);
}

/**
 * Attempt a typed fill once: set, trigger jQuery, read back.
 * @param {OpContext} ctx
 * @param {FieldDef} field
 * @param {string} value
 * @returns {Promise<import('../shared/result.js').Result<{ actual: string, alt: string }>>}
 */
async function typedAttempt(ctx, field, value) {
  const set = await ctx.send('setValue', {
    selectors: field.selectors, field: field.key, value, type: field.type, credential: credentialPatternSet(),
  });
  if (!set.ok) return set;
  const marker = typeof set.value === 'object' && set.value !== null && typeof (/** @type {{ marker?: unknown }} */ (set.value)).marker === 'string'
    ? /** @type {{ marker: string }} */ (set.value).marker
    : '';
  if (ctx.fieldMap.framework !== 'none' && marker) {
    const trig = await ctx.triggerJquery(marker, field.selectors.shadowPath);
    if (!trig.ok) return trig;
  }
  const read = await ctx.send('readBack', { selectors: field.selectors, field: field.key, type: field.type });
  if (!read.ok) return read;
  return Ok(readValue(read.value));
}

/**
 * Attempt a widget pick once.
 * @param {OpContext} ctx
 * @param {FieldDef} field
 * @param {string} value
 * @returns {Promise<import('../shared/result.js').Result<{ actual: string, alt: string }>>}
 */
async function widgetAttempt(ctx, field, value) {
  const picked = await ctx.send('pickWidget', {
    selectors: field.selectors, field: field.key, value, entry: field.entry,
    timeoutMs: TIMEOUTS.WIDGET_OPEN_MS, credential: credentialPatternSet(),
  }, TIMEOUTS.WIDGET_OPEN_MS + TIMEOUTS.SLICE_MARGIN_MS);
  if (!picked.ok) return picked;
  const read = await ctx.send('readBack', { selectors: field.selectors, field: field.key, type: field.type });
  if (!read.ok) return read;
  return Ok(readValue(read.value));
}

/**
 * Attempt a checkbox/radio once.
 * @param {OpContext} ctx
 * @param {FieldDef} field
 * @param {boolean} checked
 * @returns {Promise<import('../shared/result.js').Result<{ actual: string, alt: string }>>}
 */
async function checkAttempt(ctx, field, checked) {
  const set = await ctx.send('check', { selectors: field.selectors, field: field.key, checked });
  if (!set.ok) return set;
  return Ok(readValue({ actual: typeof set.value === 'object' && set.value !== null ? (/** @type {{ actual?: unknown }} */ (set.value)).actual : '', alt: '' }));
}

/**
 * @param {string} v
 * @returns {boolean}
 */
export function truthy(v) {
  return ['true', '1', 'yes', 'y', 'on', 'checked'].includes(v.trim().toLowerCase());
}

/**
 * Fill one field with an explicit value (already transformed). One
 * re-attempt on a mismatch, never more.
 * @param {OpContext} ctx
 * @param {FieldDef} field
 * @param {string} value
 * @returns {Promise<import('../shared/result.js').Result<FieldOutcome>>}
 */
export async function fillFieldWith(ctx, field, value) {
  const notCredential = checkFieldIsNotCredential(field);
  if (!notCredential.ok) return notCredential;

  const settled = await settleDependencies(ctx, field);
  if (!settled.ok) return settled;

  const isCheck = field.type === 'checkbox' || field.type === 'radio';
  const isWidget = field.entry.mode === 'widget';
  const expected = isCheck ? String(truthy(value)) : value;

  /** @returns {Promise<import('../shared/result.js').Result<{ actual: string, alt: string }>>} */
  const attempt = () => {
    if (isCheck) return checkAttempt(ctx, field, truthy(value));
    if (isWidget) return widgetAttempt(ctx, field, value);
    return typedAttempt(ctx, field, value);
  };

  let result = await attempt();
  if (result.ok && valuesMatch(field, expected, result.value.actual, result.value.alt)) {
    return Ok({ kind: 'filled', expected, actual: result.value.actual });
  }
  if (!result.ok && result.error.class !== 'verification') return result;

  // One re-attempt of this single field. Repeated silent retries are how a
  // wrong value ends up in a statutory filing.
  ctx.log({ op: 'fill', label: `${field.label} (re-attempt)`, outcome: 'info', ms: 0, note: 'read-back differed; re-attempting once' });
  result = await attempt();
  if (!result.ok) {
    if (result.error.class !== 'verification') return result;
    return Ok({ kind: 'mismatch', expected, actual: '', reason: result.error.message.replace(/^field `[^`]+`: /, '') });
  }
  if (valuesMatch(field, expected, result.value.actual, result.value.alt)) {
    return Ok({ kind: 'filled', expected, actual: result.value.actual });
  }
  return Ok({
    kind: 'mismatch', expected, actual: result.value.actual,
    reason: result.value.actual.trim() === '' ? 'value did not stick' : 'page holds a different value after re-attempt',
  });
}

/**
 * Fill one field from the payload: lookup, transform, length check, then
 * `fillFieldWith`.
 * @param {OpContext} ctx
 * @param {FieldDef} field
 * @returns {Promise<import('../shared/result.js').Result<FieldOutcome>>}
 */
export async function fillField(ctx, field) {
  const lookup = ctx.valueFor(field);
  switch (lookup.status) {
    case 'missing':
      if (field.optional) return Ok({ kind: 'skipped', reason: 'optional, no source value' });
      return Ok({ kind: 'mismatch', expected: '', actual: '', reason: `no source value for required field (sourceField "${field.sourceField}")` });
    case 'error':
      return Err('validation', `field \`${field.key}\`: ${lookup.message}`, { field: field.key });
    case 'tooLong':
      return Ok({ kind: 'mismatch', expected: lookup.value, actual: '', reason: `value is ${lookup.value.length} characters; the field allows ${lookup.maxLength}. Not filled.` });
    case 'value':
      return fillFieldWith(ctx, field, lookup.value);
  }
}
