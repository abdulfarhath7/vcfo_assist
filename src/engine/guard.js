// The human boundary, in code. Refuses a click whose target matches the
// danger set and a fill whose field looks like a credential. There is no
// override path: no flag, no recipe key, no argument that widens this.

import { Ok, Err } from '../shared/result.js';
import { DANGER, CREDENTIAL } from '../shared/constants.js';

/** @typedef {import('../shared/schema.js').ElementDescriptor} ElementDescriptor */
/** @typedef {import('../shared/schema.js').FieldDef} FieldDef */
/** @typedef {import('../shared/schema.js').PatternSet} PatternSet */

/**
 * The danger set as passed to the content script for its own re-check.
 * @returns {PatternSet}
 */
export function dangerPatternSet() {
  return { pattern: DANGER.pattern, flags: DANGER.flags, types: DANGER.types };
}

/**
 * The credential set as passed to the content script for its own re-check.
 * @returns {PatternSet}
 */
export function credentialPatternSet() {
  return { pattern: CREDENTIAL.pattern, flags: CREDENTIAL.flags, types: CREDENTIAL.types };
}

/**
 * Refuse a click target that matches the danger set. Matched against text,
 * value, id, name, aria-label and type. False positives are accepted; the
 * recipe answers with a different selector or a humanGate, never a wider
 * guard.
 * @param {ElementDescriptor} d
 * @param {string} selector
 * @param {string} [label]
 * @returns {import('../shared/result.js').Result<true>}
 */
export function checkClickTarget(d, selector, label = '') {
  const hit = dangerMatch(d);
  if (hit) {
    return Err('guard',
      `Step "${label || selector}" refused: \`${selector}\` targets a control matching the danger set (${hit}). Login, captcha, OTP, DSC, payment and submission stay with the human. This is a recipe bug.`,
      { selectors: [selector], step: label || undefined });
  }
  return Ok(true);
}

/**
 * @param {ElementDescriptor} d
 * @returns {string | null}
 */
function dangerMatch(d) {
  if (DANGER.types.includes(d.type)) return `type="${d.type}"`;
  const re = new RegExp(DANGER.pattern, DANGER.flags);
  /** @type {[string, string][]} */
  const attrs = [['text', d.text], ['value', d.value], ['id', d.id], ['name', d.name], ['aria-label', d.ariaLabel], ['type', d.type]];
  for (const [name, v] of attrs) {
    if (v && re.test(v)) return `${name}="${v}"`;
  }
  return null;
}

/**
 * Refuse a field definition that names a credential. The loader already
 * refuses such maps; this is the second lock on the same door.
 * @param {FieldDef} field
 * @returns {import('../shared/result.js').Result<true>}
 */
export function checkFieldIsNotCredential(field) {
  const re = new RegExp(CREDENTIAL.pattern, CREDENTIAL.flags);
  const candidates = [field.key, field.label, field.sourceField, field.selectors.primary, ...field.selectors.fallbacks];
  const hit = candidates.find((c) => re.test(c));
  if (hit !== undefined) {
    return Err('credential',
      `field \`${field.key}\`: refused, it looks like a credential field ("${hit}" matches the credential set). Credentials are never filled.`,
      { field: field.key, selectors: [field.selectors.primary, ...field.selectors.fallbacks] });
  }
  return Ok(true);
}
