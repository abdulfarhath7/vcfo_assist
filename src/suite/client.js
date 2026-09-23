// VCFO Suite API client. The only outbound requests the extension makes go
// through this file, to the configured Suite origin. With no origin set, the
// development fixture is read instead — one file, same validation path.

import { Ok, Err, fromThrown } from '../shared/result.js';
import { LOCAL_KEYS, SUITE_API, TIMEOUTS } from '../shared/constants.js';
import { fetchPackagedJson } from '../engine/loader.js';
import { isRecord } from '../shared/check.js';

/** @typedef {import('../shared/schema.js').EngagementSummary} EngagementSummary */
/** @typedef {import('../shared/schema.js').SuiteResult} SuiteResult */

const FIXTURE_PATH = 'fixtures/engagement.json';

/**
 * Read the configured Suite origin. Empty string when unset.
 * @returns {Promise<string>}
 */
export async function getSuiteOrigin() {
  const got = await chrome.storage.local.get(LOCAL_KEYS.SUITE_ORIGIN);
  const v = got[LOCAL_KEYS.SUITE_ORIGIN];
  return typeof v === 'string' ? v : '';
}

/**
 * Normalise and validate an origin typed by the user. Returns the origin
 * without a trailing slash or path.
 * @param {string} input
 * @returns {import('../shared/result.js').Result<string>}
 */
export function normaliseOrigin(input) {
  const trimmed = input.trim();
  if (trimmed === '') return Ok('');
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return Err('validation', `"${trimmed}" is not a URL. Enter the Suite origin, e.g. https://suite.example.com`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) {
    return Err('validation', 'The Suite origin must use https (http is allowed for localhost only).');
  }
  return Ok(url.origin);
}

/**
 * Store the Suite origin preference. Permission for the origin is requested
 * by the panel (it needs a user gesture) before this is called.
 * @param {string} origin  Already normalised
 * @returns {Promise<void>}
 */
export async function setSuiteOrigin(origin) {
  await chrome.storage.local.set({ [LOCAL_KEYS.SUITE_ORIGIN]: origin });
}

/**
 * Host permission pattern for an origin.
 * @param {string} origin
 * @returns {string}
 */
export function originPattern(origin) {
  return `${origin}/*`;
}

/**
 * Whether the extension currently holds host permission for the origin.
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
export async function hasOriginPermission(origin) {
  if (origin === '') return true;
  try {
    return await chrome.permissions.contains({ origins: [originPattern(origin)] });
  } catch {
    return false;
  }
}

/**
 * Request host permission for the origin. Must run from a user gesture in an
 * extension page (the side panel), not the worker.
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
export async function requestOriginPermission(origin) {
  if (origin === '') return true;
  try {
    return await chrome.permissions.request({ origins: [originPattern(origin)] });
  } catch {
    return false;
  }
}

/**
 * fetch with a worker-owned timeout and the Suite cookie session.
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<import('../shared/result.js').Result<Response>>}
 */
async function suiteFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS.SUITE_FETCH_MS);
  try {
    const response = await fetch(url, { ...init, credentials: 'include', signal: controller.signal });
    return Ok(response);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return Err('transport', `VCFO Suite did not answer within ${TIMEOUTS.SUITE_FETCH_MS / 1000}s (${url}).`);
    }
    return fromThrown('transport', e, `Could not reach VCFO Suite at ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate a non-OK Suite response into a named error. 401 is explicit.
 * @param {Response} response
 * @param {string} what
 * @returns {import('../shared/result.js').ErrResult}
 */
function httpError(response, what) {
  if (response.status === 401 || response.status === 403) {
    return Err('auth', 'Sign in to VCFO Suite in another tab, then retry.', { details: { status: response.status } });
  }
  if (response.status === 404) {
    return Err('transport', `VCFO Suite has no ${what} endpoint at this origin (404).`, { details: { status: 404 } });
  }
  return Err('transport', `VCFO Suite returned ${response.status} for ${what}.`, { details: { status: response.status } });
}

/**
 * List engagements that can be filled for a form. Returns an empty list when
 * Suite has no list endpoint, so the panel can fall back to a typed id.
 * @param {string} origin
 * @param {string} formId
 * @returns {Promise<import('../shared/result.js').Result<{ engagements: EngagementSummary[], listSupported: boolean }>>}
 */
export async function fetchEngagementList(origin, formId) {
  const r = await suiteFetch(`${origin}${SUITE_API.list(formId)}`, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!r.ok) return r;
  if (r.value.status === 404) return Ok({ engagements: [], listSupported: false });
  if (!r.value.ok) return httpError(r.value, 'engagement list');
  /** @type {unknown} */
  let body;
  try {
    body = await r.value.json();
  } catch (e) {
    return fromThrown('transport', e, 'Engagement list was not valid JSON');
  }
  const list = isRecord(body) && Array.isArray(body.engagements) ? body.engagements : (Array.isArray(body) ? body : null);
  if (!list) return Err('validation', 'Engagement list response did not contain an "engagements" array.');
  /** @type {EngagementSummary[]} */
  const engagements = [];
  for (const item of list) {
    if (isRecord(item) && typeof item.id === 'string' && typeof item.companyName === 'string') {
      engagements.push({ id: item.id, companyName: item.companyName, stage: typeof item.stage === 'string' ? item.stage : '' });
    }
  }
  return Ok({ engagements, listSupported: true });
}

/**
 * Fetch the export payload for one engagement. The raw JSON is returned;
 * validation happens in `validate.js` so both inbound paths share it.
 * @param {string} origin
 * @param {string} engagementId
 * @param {string} formId
 * @returns {Promise<import('../shared/result.js').Result<unknown>>}
 */
export async function fetchEngagementExport(origin, engagementId, formId) {
  const r = await suiteFetch(`${origin}${SUITE_API.exportPath(engagementId, formId)}`, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!r.ok) return r;
  if (!r.value.ok) return httpError(r.value, 'engagement export');
  try {
    return Ok(await r.value.json());
  } catch (e) {
    return fromThrown('transport', e, 'Engagement export was not valid JSON');
  }
}

/**
 * Read the development fixture. Used only when no Suite origin is set.
 * @returns {Promise<import('../shared/result.js').Result<unknown>>}
 */
export async function loadFixture() {
  const r = await fetchPackagedJson(FIXTURE_PATH);
  if (!r.ok) return r;
  if (r.value === null) return Err('validation', `${FIXTURE_PATH} is missing from this build.`);
  return Ok(r.value);
}

/**
 * Post a captured result back to Suite. Idempotent on
 * `{ engagementId, form, srn }`; the same key is sent as an Idempotency-Key
 * header so a repeat updates rather than duplicates.
 * @param {string} origin
 * @param {string} engagementId
 * @param {SuiteResult} result
 * @returns {Promise<import('../shared/result.js').Result<{ status: number }>>}
 */
export async function postResult(origin, engagementId, result) {
  const r = await suiteFetch(`${origin}${SUITE_API.resultPath(engagementId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': `${engagementId}:${result.form}:${result.srn}`,
    },
    body: JSON.stringify(result),
  });
  if (!r.ok) return r;
  if (!r.value.ok) return httpError(r.value, 'result post');
  return Ok({ status: r.value.status });
}
