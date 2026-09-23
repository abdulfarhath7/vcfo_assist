// The fixed transform set from docs/04. No arbitrary expressions. Applied
// left to right to the Suite value before it is filled and before it is
// shown in panel 2, so what the lead checks is what gets typed.

import { Ok, Err } from '../shared/result.js';
import { TRANSFORMS } from '../shared/constants.js';

/** @typedef {import('../shared/schema.js').FieldValue} FieldValue */

/**
 * Parse a date given as ISO `YYYY-MM-DD[T…]`, `DD/MM/YYYY`, `DD-MM-YYYY` or
 * `YYYY/MM/DD`. Returns null when unrecognised.
 * @param {string} s
 * @returns {{ d: number, m: number, y: number } | null}
 */
function parseDate(s) {
  const t = s.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(t);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]) };
  return null;
}

/** @param {number} n @param {number} w */
const pad = (n, w) => String(n).padStart(w, '0');

/**
 * Apply one named transform.
 * @param {string} name
 * @param {string} value
 * @returns {import('../shared/result.js').Result<string>}
 */
function applyOne(name, value) {
  switch (name) {
    case 'trim': return Ok(value.trim());
    case 'upper': return Ok(value.toUpperCase());
    case 'lower': return Ok(value.toLowerCase());
    case 'digitsOnly': return Ok(value.replace(/\D+/g, ''));
    case 'dateDDMMYYYY': {
      const p = parseDate(value);
      if (!p) return Err('validation', `value is not a recognisable date for transform dateDDMMYYYY`);
      return Ok(`${pad(p.d, 2)}/${pad(p.m, 2)}/${pad(p.y, 4)}`);
    }
    case 'dateYYYYMMDD': {
      const p = parseDate(value);
      if (!p) return Err('validation', `value is not a recognisable date for transform dateYYYYMMDD`);
      return Ok(`${pad(p.y, 4)}-${pad(p.m, 2)}-${pad(p.d, 2)}`);
    }
    default:
      return Err('validation', `unknown transform "${name}" (allowed: ${TRANSFORMS.join(', ')})`);
  }
}

/**
 * Coerce a Suite field value to the string that will be typed.
 * @param {FieldValue | undefined} v
 * @returns {string | null}
 */
export function toText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  return v;
}

/**
 * Apply a pipe-separated transform list. Error messages name the transform,
 * never the value.
 * @param {string} pipeline   e.g. "trim|upper"
 * @param {string} value
 * @returns {import('../shared/result.js').Result<string>}
 */
export function applyTransforms(pipeline, value) {
  let out = value;
  const names = pipeline.split('|').map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    const r = applyOne(name, out);
    if (!r.ok) return r;
    out = r.value;
  }
  return Ok(out);
}
