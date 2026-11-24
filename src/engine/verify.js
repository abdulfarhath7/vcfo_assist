// Read-back verification. After every fillGroup the engine reads each filled
// field back from the page and compares it with what it meant to type. The
// result is a Diff the panel shows in full. Nothing here retries.

import { Ok } from '../shared/result.js';
import { TIMEOUTS } from '../shared/constants.js';
import { selectorsFor } from './context.js';
import { applyTransforms } from './transform.js';

/** @typedef {import('../shared/schema.js').FieldDef} FieldDef */
/** @typedef {import('../shared/schema.js').Diff} Diff */
/** @typedef {import('../shared/schema.js').DiffMismatch} DiffMismatch */
/** @typedef {import('../shared/schema.js').DiffSkip} DiffSkip */
/** @typedef {import('./context.js').OpContext} OpContext */

/**
 * @returns {Diff}
 */
export function emptyDiff() {
  return { checked: 0, matched: 0, mismatches: [], skipped: [] };
}

/**
 * Whitespace-collapsed, case-folded comparison key.
 * @param {string} s
 * @returns {string}
 */
export function normalise(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Whether what the page holds counts as the value we typed. The page's value
 * is run through the field's own transform first, so a portal that trims or
 * upper-cases on blur does not read as a mismatch; leading and trailing
 * whitespace never count. Choice controls accept the displayed text or the
 * underlying value, case-insensitively.
 * @param {FieldDef} field
 * @param {string} expected   Already transformed
 * @param {string} actual
 * @param {string} alt
 * @returns {boolean}
 */
export function valuesMatch(field, expected, actual, alt) {
  const choice = field.type === 'select' || field.entry.mode === 'widget';
  if (field.type === 'checkbox' || field.type === 'radio') {
    return normalise(actual) === normalise(expected);
  }
  if (field.entry.widgetKind === 'checklist') {
    // The page reports every ticked box; each value asked for must be among them.
    const ticked = actual.split(' | ').map((x) => normalise(x));
    const wants = expected.split(';').map((x) => normalise(x)).filter(Boolean);
    return wants.length > 0 && wants.every((w) => ticked.includes(w));
  }
  if (field.type === 'file') {
    // The input's own file name, or the page's list of uploaded files naming it.
    const want = normalise(expected);
    return normalise(actual) === want || (want !== '' && normalise(alt).includes(want));
  }
  if (choice) {
    const want = normalise(expected);
    return normalise(actual) === want || normalise(alt) === want;
  }
  const transformed = applyTransforms(field.transform, actual);
  const pageValue = transformed.ok ? transformed.value : actual;
  return pageValue.trim() === expected.trim() || actual.trim() === expected.trim();
}

/**
 * Merge a group diff into the run's cumulative diff. A later group's read of
 * a key replaces an earlier one, so a dependent control that reset an
 * earlier field is reported, not hidden.
 * @param {Diff | null} into
 * @param {Diff} add
 * @returns {Diff}
 */
export function mergeDiff(into, add) {
  const base = into ?? emptyDiff();
  const keys = new Set([...add.mismatches.map((m) => m.key), ...add.skipped.map((s) => s.key)]);
  const mismatches = [...base.mismatches.filter((m) => !keys.has(m.key)), ...add.mismatches];
  const skipped = [...base.skipped.filter((s) => !keys.has(s.key)), ...add.skipped];
  return {
    checked: base.checked + add.checked,
    matched: base.matched + add.matched,
    mismatches,
    skipped,
  };
}

/**
 * Read every filled field back and build the group's Diff. Fields whose
 * fill already produced a mismatch are read again anyway, so the diff is
 * what the page holds now, not what the fill op remembers.
 * @param {OpContext} ctx
 * @param {FieldDef[]} fields
 * @param {Map<string, string>} expectedByKey   Fields that received a value
 * @param {DiffSkip[]} skipped
 * @param {Map<string, string>} reasons         Pre-recorded reasons per key (e.g. exceeds maxLength)
 * @returns {Promise<import('../shared/result.js').Result<Diff>>}
 */
export async function verifyFields(ctx, fields, expectedByKey, skipped, reasons) {
  /** @type {Diff} */
  const diff = { checked: 0, matched: 0, mismatches: [], skipped: [...skipped] };
  for (const field of fields) {
    const expected = expectedByKey.get(field.key);
    if (expected === undefined) continue;
    diff.checked += 1;
    const read = await readField(ctx, field, expected);
    if (!read.ok) {
      diff.mismatches.push({
        key: field.key, label: field.label, expected, actual: '',
        reason: reasons.get(field.key) ?? `could not read back: ${read.error.message}`,
      });
      continue;
    }
    const { actual, alt } = read.value;
    if (valuesMatch(field, expected, actual, alt)) {
      diff.matched += 1;
    } else {
      diff.mismatches.push({
        key: field.key, label: field.label, expected, actual,
        reason: reasons.get(field.key) ?? (actual.trim() === '' ? 'value did not stick' : 'page holds a different value'),
      });
    }
  }
  return Ok(diff);
}

/**
 * @param {unknown} v
 * @returns {{ actual: string, alt: string }}
 */
export function readValue(v) {
  if (typeof v === 'object' && v !== null) {
    const o = /** @type {{ actual?: unknown, alt?: unknown }} */ (v);
    return {
      actual: typeof o.actual === 'string' ? o.actual : '',
      alt: typeof o.alt === 'string' ? o.alt : '',
    };
  }
  return { actual: '', alt: '' };
}

/**
 * Read one field back from the page. A field with `verifyIn` (a search widget
 * that clears itself and adds a row) is read from that element instead: it
 * matches when the element's text contains the expected value. Shared by the
 * fill attempt and the group verification so both judge the same way.
 * @param {import('./context.js').OpContext} ctx
 * @param {import('../shared/schema.js').FieldDef} field
 * @param {string} expected
 * @returns {Promise<import('../shared/result.js').Result<{ actual: string, alt: string }>>}
 */
export async function readField(ctx, field, expected) {
  if (field.verifyIn) {
    const r = await ctx.send('readText', { selectors: selectorsFor(field.verifyIn), field: field.key, read: 'text' }, TIMEOUTS.OP_MS);
    if (!r.ok) return r;
    const text = typeof r.value === 'object' && r.value !== null && typeof (/** @type {{ text?: unknown }} */ (r.value)).text === 'string'
      ? /** @type {{ text: string }} */ (r.value).text : '';
    const found = expected.trim() !== '' && normalise(text).includes(normalise(expected));
    return Ok({ actual: found ? expected : '', alt: found ? expected : '' });
  }
  const read = await ctx.send('readBack', { selectors: field.selectors, field: field.key, type: field.type }, TIMEOUTS.OP_MS);
  if (!read.ok) return read;
  return Ok(readValue(read.value));
}
