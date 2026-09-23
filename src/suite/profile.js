// The VCFO Suite assist profile: validation of the response from
// GET /api/engagements/{id}/assist-profile, and binding of its nested profile
// to the flat `fields` the field maps read by `sourceField`.
//
// Binding. Every leaf becomes a dotted path (`company.nicCode`,
// `company.proposedNames.0`, `directors.1.firstName`). The portal's repeat
// blocks get their own views, built exactly as the reference build's
// mapping.js splits them, so a map entry can say `directors[withDin].0.din`:
//   subscribers[bodyCorporate]          kind === 'bodyCorporate'
//   subscribers[individualWithDin]      other subscribers with a DIN
//   subscribers[individualWithoutDin]   other subscribers without one
//   directors[withDin] / [withoutDin]   subscriber-directors, then directors,
//                                        split by DIN
// `mcaLogin` is never bound: Suite sends it empty, and a non-empty login is
// refused before anything is stored.

import { Ok, Err } from '../shared/result.js';
import { SUPPORTED_SCHEMA_VERSIONS } from '../shared/constants.js';
import { isRecord } from '../shared/check.js';

/** @typedef {import('../shared/schema.js').FieldValue} FieldValue */
/** @typedef {import('../shared/schema.js').SuitePayload} SuitePayload */
/** @typedef {import('../shared/schema.js').SuiteMissing} SuiteMissing */
/** @typedef {import('../shared/schema.js').SuiteNote} SuiteNote */

/**
 * The validated Suite response.
 * @typedef {object} AssistProfileResponse
 * @property {number} schemaVersion
 * @property {string} companyName
 * @property {Record<string, unknown>} profile
 * @property {SuiteMissing[]} missing
 * @property {SuiteNote[]} notes
 */

/**
 * @param {unknown} v
 * @returns {boolean}
 */
const hasDin = (v) => isRecord(v) && typeof v.din === 'string' && v.din.trim() !== '';

/**
 * @param {unknown} v
 * @returns {Record<string, unknown>[]}
 */
const records = (v) => (Array.isArray(v) ? v.filter(isRecord) : []);

/**
 * Check the response body and the one rule Assist enforces itself: no MCA
 * credential ever arrives. Messages name the key or the version at fault.
 * @param {unknown} body
 * @param {string} origin   For messages
 * @returns {import('../shared/result.js').Result<AssistProfileResponse>}
 */
export function validateProfileResponse(body, origin) {
  if (!isRecord(body)) return Err('validation', `${origin} answered, but not with a JSON object.`);
  if (body.ok === false) {
    return Err('validation', `${origin} refused the profile: ${typeof body.error === 'string' ? body.error : 'no reason given'}.`);
  }
  const version = body.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return Err('validation', `The profile from ${origin} has no integer schemaVersion.`);
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    return Err('version',
      `VCFO Suite sent profile schemaVersion ${version}; this build of Assist understands schemaVersion ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}. Update Assist, or ask for Suite to be matched to it.`);
  }
  if (!isRecord(body.profile)) return Err('validation', `The profile from ${origin} has no "profile" object.`);
  const login = body.profile.mcaLogin;
  if (isRecord(login) && typeof login.userId === 'string' && login.userId.trim() !== '') {
    return Err('credential',
      'The Suite profile carries an MCA login id in mcaLogin.userId. Assist never takes MCA credentials; nothing was stored. Report this to whoever runs VCFO Suite.');
  }

  /** @type {SuiteMissing[]} */
  const missing = [];
  if (body.missing !== undefined && !Array.isArray(body.missing)) {
    return Err('validation', `The profile from ${origin} has a "missing" that is not a list.`);
  }
  for (const [i, m] of records(body.missing).entries()) {
    if (typeof m.key !== 'string' || typeof m.label !== 'string' || typeof m.stepId !== 'string') {
      return Err('validation', `missing[${i}] from ${origin} lacks key, label or stepId.`);
    }
    /** @type {SuiteMissing} */
    const item = { key: m.key, label: m.label, stepId: m.stepId };
    if (typeof m.tabId === 'string') item.tabId = m.tabId;
    if (typeof m.reason === 'string') item.reason = m.reason;
    if (typeof m.directorIndex === 'number') item.directorIndex = m.directorIndex;
    missing.push(item);
  }
  /** @type {SuiteNote[]} */
  const notes = [];
  if (body.notes !== undefined && !Array.isArray(body.notes)) {
    return Err('validation', `The profile from ${origin} has "notes" that is not a list.`);
  }
  for (const [i, n] of records(body.notes).entries()) {
    if (typeof n.key !== 'string' || typeof n.note !== 'string') return Err('validation', `notes[${i}] from ${origin} lacks key or note.`);
    notes.push({ key: n.key, note: n.note });
  }
  return Ok({
    schemaVersion: version,
    companyName: typeof body.companyName === 'string' ? body.companyName : '',
    profile: body.profile,
    missing,
    notes,
  });
}

/**
 * Flatten one value under a path prefix into `out`. Arrays index by position;
 * null and undefined are omitted (Suite omits what it does not hold).
 * @param {unknown} value
 * @param {string} prefix
 * @param {Record<string, FieldValue>} out
 */
function flattenInto(value, prefix, out) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'boolean') {
    out[prefix] = value;
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) out[prefix] = value;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenInto(v, `${prefix}.${i}`, out));
    return;
  }
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) flattenInto(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

/**
 * The profile as the flat `fields` every field map binds to by `sourceField`.
 * @param {Record<string, unknown>} profile
 * @returns {Record<string, FieldValue>}
 */
export function bindProfile(profile) {
  /** @type {Record<string, FieldValue>} */
  const out = {};
  for (const [section, value] of Object.entries(profile)) {
    if (section === 'mcaLogin') continue;
    flattenInto(value, section, out);
  }
  // The portal's repeat blocks, as mapping.js builds them.
  const subscribers = records(profile.subscribers);
  const individuals = subscribers.filter((s) => s.kind !== 'bodyCorporate');
  const directors = individuals.filter((s) => s.isDirector === true).concat(records(profile.directors));
  /** @type {Record<string, Record<string, unknown>[]>} */
  const views = {
    'subscribers[bodyCorporate]': subscribers.filter((s) => s.kind === 'bodyCorporate'),
    'subscribers[individualWithDin]': individuals.filter(hasDin),
    'subscribers[individualWithoutDin]': individuals.filter((s) => !hasDin(s)),
    'directors[withDin]': directors.filter(hasDin),
    'directors[withoutDin]': directors.filter((d) => !hasDin(d)),
  };
  for (const [name, list] of Object.entries(views)) flattenInto(list, name, out);
  return out;
}

/**
 * Build the SuitePayload the engine runs on from a validated response. The
 * profile feeds every form, so `form` is the one the lead picked.
 * @param {AssistProfileResponse} response
 * @param {{ engagementId: string, formId: string }} ctx
 * @returns {SuitePayload}
 */
export function payloadFromProfile(response, ctx) {
  return {
    schemaVersion: response.schemaVersion,
    // The profile route reports no Suite version; no skew warning is raised.
    suiteVersion: '',
    form: ctx.formId,
    engagement: { id: ctx.engagementId, companyName: response.companyName || ctx.engagementId, stage: '' },
    fields: bindProfile(response.profile),
    issuedAt: new Date().toISOString(),
    missing: response.missing,
    notes: response.notes,
  };
}

/**
 * Whether a raw object is shaped like the profile response rather than a
 * flat payload (used for bundles, which may carry either).
 * @param {unknown} raw
 * @returns {boolean}
 */
export function looksLikeProfileResponse(raw) {
  return isRecord(raw) && isRecord(raw.profile) && !isRecord(raw.fields);
}
