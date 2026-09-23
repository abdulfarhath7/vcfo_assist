// Validation of a Suite payload, whichever path produced it. Refuses to
// proceed unless the schema version is understood, the form matches, the
// field map's requirement is satisfied, and every non-optional sourceField the
// map references exists in `fields`. Failures list the missing keys.

import { Ok, Err } from '../shared/result.js';
import { SUPPORTED_SCHEMA_VERSIONS, KNOWN_SUITE_RANGE } from '../shared/constants.js';
import { isRecord, Problems } from '../shared/check.js';

/** @typedef {import('../shared/schema.js').SuitePayload} SuitePayload */
/** @typedef {import('../shared/schema.js').FieldMap} FieldMap */
/** @typedef {import('../shared/schema.js').Recipe} Recipe */

/**
 * Structural check of a raw payload. Values are not inspected beyond type.
 * @param {unknown} raw
 * @returns {import('../shared/result.js').Result<SuitePayload>}
 */
export function validatePayloadShape(raw) {
  const p = new Problems('payload');
  if (!isRecord(raw)) return Err('validation', 'Suite payload must be a JSON object');
  const schemaVersion = p.int(raw, 'schemaVersion');
  const suiteVersion = p.string(raw, 'suiteVersion');
  const form = p.string(raw, 'form');
  const issuedAt = p.string(raw, 'issuedAt');
  const engagementRaw = p.record(raw, 'engagement');
  /** @type {import('../shared/schema.js').SuiteEngagement | undefined} */
  let engagement;
  if (engagementRaw) {
    const id = p.string(engagementRaw, 'id', 'engagement.id');
    const companyName = p.string(engagementRaw, 'companyName', 'engagement.companyName');
    const stage = p.string(engagementRaw, 'stage', 'engagement.stage');
    if (id !== undefined && companyName !== undefined && stage !== undefined) {
      engagement = { id, companyName, stage };
    }
  }
  const fieldsRaw = p.record(raw, 'fields');
  /** @type {Record<string, import('../shared/schema.js').FieldValue>} */
  const fields = {};
  if (fieldsRaw) {
    for (const [k, v] of Object.entries(fieldsRaw)) {
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        fields[k] = v;
      } else {
        p.add(`fields.${k}`, 'must be a string, number, boolean or null');
      }
    }
  }
  let expiresAt;
  if (raw.expiresAt !== undefined) expiresAt = p.string(raw, 'expiresAt');
  if (p.any) return Err('validation', `Suite payload failed validation: ${p.list.join('; ')}`, { missing: p.list });
  if (schemaVersion === undefined || suiteVersion === undefined || form === undefined
    || issuedAt === undefined || engagement === undefined) {
    return Err('validation', 'Suite payload failed validation');
  }
  /** @type {SuitePayload} */
  const payload = { schemaVersion, suiteVersion, form, engagement, fields, issuedAt };
  if (expiresAt !== undefined) payload.expiresAt = expiresAt;
  return Ok(payload);
}

/**
 * Parse `YYYY.MM.N` into comparable parts. Unparseable input is treated as
 * newer than anything, so it is refused.
 * @param {string} v
 * @returns {number[]}
 */
function versionParts(v) {
  const parts = v.trim().split('.').map((x) => Number.parseInt(x, 10));
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return [Number.POSITIVE_INFINITY];
  return parts;
}

/**
 * Compare two Suite versions. Negative when a < b, zero when equal, positive
 * when a > b.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSuiteVersion(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Version skew is a warning, never a refusal. Returns a sentence for the
 * panel when `suiteVersion` falls outside the range this build was
 * exercised against, or null.
 * @param {SuitePayload} payload
 * @returns {string | null}
 */
export function suiteVersionWarning(payload) {
  if (compareSuiteVersion(payload.suiteVersion, KNOWN_SUITE_RANGE.to) > 0) {
    return `VCFO Suite ${payload.suiteVersion} is newer than this build of Assist was exercised against (up to ${KNOWN_SUITE_RANGE.to}). The schema version matches, so filling continues; check the Verify table with care and update Assist when one is available.`;
  }
  if (compareSuiteVersion(payload.suiteVersion, KNOWN_SUITE_RANGE.from) < 0) {
    return `VCFO Suite ${payload.suiteVersion} is older than this build of Assist was exercised against (from ${KNOWN_SUITE_RANGE.from}). The schema version matches, so filling continues.`;
  }
  return null;
}

/**
 * The four validation rules of docs/03, applied once a recipe and field map
 * are loaded. Never partial-fills on failure: the caller gets an error naming
 * every missing key. Suite version skew is returned as a warning.
 * @param {SuitePayload} payload
 * @param {string} formId
 * @param {Recipe} recipe
 * @param {FieldMap} fieldMap
 * @returns {import('../shared/result.js').Result<{ warnings: string[] }>}
 */
export function validatePayloadForForm(payload, formId, recipe, fieldMap) {
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(payload.schemaVersion)) {
    return Err('version',
      `Payload schemaVersion ${payload.schemaVersion} is not understood by this build (supports ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}).`);
  }
  /** @type {string[]} */
  const warnings = [];
  const skew = suiteVersionWarning(payload);
  if (skew) warnings.push(skew);
  if (payload.form !== formId) {
    return Err('validation', `Payload is for form "${payload.form}" but "${formId}" was selected.`);
  }
  if (payload.schemaVersion !== fieldMap.requiresSchemaVersion) {
    return Err('version',
      `Field map "${fieldMap.id}" requires schemaVersion ${fieldMap.requiresSchemaVersion}; payload is schemaVersion ${payload.schemaVersion}.`);
  }
  if (payload.schemaVersion !== recipe.requiresSchemaVersion) {
    return Err('version',
      `Recipe "${recipe.id}" requires schemaVersion ${recipe.requiresSchemaVersion}; payload is schemaVersion ${payload.schemaVersion}.`);
  }
  /** @type {string[]} */
  const missing = [];
  for (const fields of Object.values(fieldMap.sections)) {
    for (const f of fields) {
      if (f.optional) continue;
      if (!(f.sourceField in payload.fields)) missing.push(`${f.key} ← ${f.sourceField}`);
    }
  }
  if (missing.length) {
    return Err('validation',
      `The Suite payload lacks ${missing.length} field${missing.length === 1 ? '' : 's'} the map requires: ${missing.join(', ')}`,
      { missing });
  }
  return Ok({ warnings });
}

/**
 * Whether a payload has passed its `expiresAt` (bundle payloads only).
 * @param {SuitePayload} payload
 * @param {Date} [now]
 * @returns {import('../shared/result.js').Result<true>}
 */
export function checkPayloadExpiry(payload, now = new Date()) {
  if (payload.expiresAt === undefined) return Ok(true);
  const t = Date.parse(payload.expiresAt);
  if (Number.isNaN(t)) return Err('validation', `Payload expiresAt "${payload.expiresAt}" is not a valid date.`);
  if (t < now.getTime()) return Err('validation', `Payload expired at ${payload.expiresAt}. Export a fresh bundle from VCFO Suite.`);
  return Ok(true);
}
