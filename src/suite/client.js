// VCFO Suite API client. Every request to Suite runs *inside a Suite tab*
// (chrome.scripting.executeScript, MAIN world): same-origin, so the Auth.js
// session cookie (SameSite=Lax) is sent and Suite needs no CORS, token or
// cookie change (Suite docs/assist-bridge/docs/06-no-cors.md). A fetch from the
// extension origin would be cross-site and answer 401. With no origin set, the
// development fixture is read instead — same validation path.

import { Ok, Err } from '../shared/result.js';
import { LOCAL_KEYS, SUITE_API, TIMEOUTS } from '../shared/constants.js';
import { fetchPackagedJson } from '../engine/loader.js';
import { waitForTabComplete } from '../engine/transport.js';

/** @typedef {import('../shared/schema.js').SuiteResult} SuiteResult */

const FIXTURE_PATH = 'fixtures/engagement.json';
/** The GST development fixture (docs/gst-profile-contract.md shape). */
const GST_FIXTURE_PATH = 'fixtures/gst-engagement.json';

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

/** Origins offered on first setup. Either still needs the lead's permission on save. */
export const SUITE_ORIGIN_DEFAULTS = Object.freeze(['https://app.sbctrack.in', 'http://localhost:3000']);

/**
 * Suite pages that name an engagement: `/app/{admin|manager|super|intern}/{projects|engagements}/{id or slug}`.
 * @param {string} url
 * @returns {string | null}
 */
export function engagementFromSuiteUrl(url) {
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const m = /^\/app\/(?:admin|manager|super|intern)\/(?:projects|engagements)\/([^/?#]+)/.exec(pathname);
  if (!m || m[1] === 'new') return null;
  return decodeURIComponent(m[1]);
}

/**
 * Open tabs on the Suite origin, the active / most recently used first.
 * @param {string} origin
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
async function suiteTabs(origin) {
  try {
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    return tabs.filter((t) => typeof t.id === 'number')
      .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  } catch {
    return [];
  }
}

/**
 * An engagement the lead already has open in Suite, for preselection.
 * @param {string} origin
 * @returns {Promise<{ engagementId: string, tabId: number, title: string } | null>}
 */
export async function detectSuiteEngagement(origin) {
  if (origin === '') return null;
  for (const tab of await suiteTabs(origin)) {
    const id = engagementFromSuiteUrl(tab.url ?? '');
    if (id && typeof tab.id === 'number') return { engagementId: id, tabId: tab.id, title: tab.title ?? '' };
  }
  return null;
}

/**
 * What the in-page fetch returns. Runs in the Suite page, so it is written
 * self-contained: no closure over anything in the worker.
 * @param {string} path
 * @param {{ method: string, headers: Record<string, string>, body?: string }} init
 * @returns {Promise<{ status: number, body: unknown, network: boolean }>}
 */
async function inPageFetch(path, init) {
  try {
    const res = await fetch(path, { ...init, credentials: 'include' });
    /** @type {unknown} */
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body, network: false };
  } catch {
    return { status: 0, body: null, network: true };
  }
}

/**
 * Run a request inside a Suite tab: an open one when there is one, else a
 * background tab opened for the purpose and closed again.
 * @param {string} origin
 * @param {string} path   Same-origin path, e.g. `/api/engagements/x/assist-profile`
 * @param {{ method: string, headers: Record<string, string>, body?: string }} init
 * @returns {Promise<import('../shared/result.js').Result<{ status: number, body: unknown, tabId: number }>>}
 */
async function suiteRequest(origin, path, init) {
  if (!(await hasOriginPermission(origin))) {
    return Err('auth', `Allow access to ${origin} to load engagements. Save the Suite origin again to be asked.`);
  }
  const open = (await suiteTabs(origin)).find((t) => t.status === 'complete') ?? (await suiteTabs(origin))[0];
  let tabId = open?.id ?? -1;
  let opened = false;
  if (tabId < 0) {
    try {
      const tab = await chrome.tabs.create({ url: `${origin}/`, active: false });
      tabId = tab.id ?? -1;
      opened = true;
    } catch {
      return Err('transport', `Could not open a ${origin} tab. Check the address, or import a bundle instead.`);
    }
    const loaded = await waitForTabComplete(tabId, TIMEOUTS.SUITE_FETCH_MS);
    if (!loaded.ok) {
      await closeTab(tabId);
      return Err('transport', `Could not reach ${origin}. Check the address, or import a bundle instead.`);
    }
  }
  try {
    const run = chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: inPageFetch, args: [path, init] });
    /** @type {Promise<'timeout'>} */
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), TIMEOUTS.SUITE_FETCH_MS));
    const outcome = await Promise.race([run, timeout]);
    if (outcome === 'timeout') {
      return Err('transport', `${origin} did not answer within ${TIMEOUTS.SUITE_FETCH_MS / 1000}s. Check the address, or import a bundle instead.`);
    }
    const result = /** @type {{ status: number, body: unknown, network: boolean } | undefined} */ (outcome[0]?.result);
    if (!result || result.network) {
      return Err('transport', `Could not reach ${origin}. Check the address, or import a bundle instead.`);
    }
    return Ok({ status: result.status, body: result.body, tabId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/error page/i.test(msg)) return Err('transport', `Could not reach ${origin}. Check the address, or import a bundle instead.`);
    if (/permission|Cannot access/i.test(msg)) return Err('auth', `Allow access to ${origin} to load engagements. Save the Suite origin again to be asked.`);
    return Err('transport', `Could not run the request in the ${origin} tab: ${msg}`);
  } finally {
    if (opened) await closeTab(tabId);
  }
}

/**
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Already gone.
  }
}

/**
 * Translate a non-OK Suite status into a named error. Every message names the
 * origin and, where there is one, the engagement. 401 carries the Suite tab so
 * the panel can offer to focus it.
 * @param {number} status
 * @param {string} what      e.g. `the profile for engagement "acme"`
 * @param {string} origin
 * @param {number} tabId
 * @returns {import('../shared/result.js').ErrResult}
 */
function httpError(status, what, origin, tabId) {
  const details = { details: { status, tabId } };
  if (status === 401) return Err('auth', 'Sign in to VCFO Suite, then click Start again.', details);
  if (status === 403) {
    return Err('auth', `${origin} refused ${what} (403). Only staff assigned to the engagement can load it; clients never can.`, details);
  }
  if (status === 404) {
    return Err('transport', `${origin} has no ${what} visible to you (404). Check the engagement id or slug, and that this is the right Suite.`, details);
  }
  return Err('transport', `${origin} returned ${status} for ${what}.`, details);
}

/**
 * GET {origin}/api/engagements/{id}/assist-profile, fetched inside a Suite
 * tab. The raw JSON is returned; `suite/profile.js` validates and binds it.
 * @param {string} origin
 * @param {string} engagementId   Id or slug, as Suite's route accepts either
 * @param {string} [form]          Profile form, e.g. `gst-reg-01`; none for SPICe+
 * @returns {Promise<import('../shared/result.js').Result<unknown>>}
 */
export async function fetchAssistProfile(origin, engagementId, form) {
  const what = `the assist profile for engagement "${engagementId}"`;
  const r = await suiteRequest(origin, SUITE_API.assistProfile(engagementId, form), { method: 'GET', headers: { Accept: 'application/json' } });
  if (!r.ok) return r;
  if (r.value.status < 200 || r.value.status >= 300) return httpError(r.value.status, what, origin, r.value.tabId);
  if (r.value.body === null) return Err('transport', `${origin} answered for ${what}, but not with JSON. Is this the VCFO Suite origin?`);
  return Ok(r.value.body);
}

/**
 * Read the development fixture. Used only when no Suite origin is set.
 * @param {string} [formId]  A GST form reads the GST fixture
 * @returns {Promise<import('../shared/result.js').Result<unknown>>}
 */
export async function loadFixture(formId = '') {
  const path = formId.startsWith('gst-') ? GST_FIXTURE_PATH : FIXTURE_PATH;
  const r = await fetchPackagedJson(path);
  if (!r.ok) return r;
  if (r.value === null) return Err('validation', `${path} is missing from this build.`);
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
  const r = await suiteRequest(origin, SUITE_API.resultPath(engagementId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': `${engagementId}:${result.form}:${result.srn}`,
    },
    body: JSON.stringify(result),
  });
  if (!r.ok) return r;
  if (r.value.status < 200 || r.value.status >= 300) {
    return httpError(r.value.status, `the result post for engagement "${engagementId}"`, origin, r.value.tabId);
  }
  return Ok({ status: r.value.status });
}

/**
 * A file ready for an upload field.
 * @typedef {object} FetchedFile
 * @property {string} fileName
 * @property {string} contentType
 * @property {string} base64
 * @property {number} sizeBytes
 */

/**
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Fetch one document the profile offers. First Suite's own attachments route,
 * inside a Suite tab (same-origin, staff session, audited by Suite); then the
 * document's signed URL from the worker. A data: URL (development fixture)
 * is read directly. Nothing is written to disk; the bytes go straight to the
 * page's file input.
 * @param {string} origin   Suite origin, '' in fixture mode
 * @param {string} engagementId
 * @param {import('../shared/schema.js').SuiteDocument} doc
 * @returns {Promise<import('../shared/result.js').Result<FetchedFile>>}
 */
export async function fetchDocument(origin, engagementId, doc) {
  /** @type {string[]} */
  const tried = [];
  if (origin !== '' && engagementId !== 'fixture') {
    const r = await suiteRequest(origin, SUITE_API.attachmentPath(engagementId, doc.key), { method: 'GET', headers: { Accept: 'application/json' } });
    if (r.ok && r.value.status === 200 && r.value.body && typeof r.value.body === 'object') {
      const b = /** @type {Record<string, unknown>} */ (r.value.body);
      if (typeof b.base64 === 'string') {
        return Ok({
          fileName: typeof b.fileName === 'string' ? b.fileName : doc.fileName,
          contentType: typeof b.contentType === 'string' ? b.contentType : doc.contentType,
          base64: b.base64,
          sizeBytes: Math.floor((b.base64.length * 3) / 4),
        });
      }
    }
    if (r.ok && r.value.status === 401) return httpError(401, `the document ${doc.key}`, origin, r.value.tabId);
    tried.push(r.ok ? `Suite attachments route answered ${r.value.status}` : r.error.message);
  }
  // The fall-back reads only an inline data: URL (the development fixture) or a
  // URL on the Suite origin itself: no network egress except VCFO Suite.
  let sameSuite = false;
  try {
    sameSuite = origin !== '' && new URL(doc.url).origin === origin;
  } catch {
    sameSuite = false;
  }
  if (doc.url && !doc.url.startsWith('data:') && !sameSuite) {
    tried.push('the signed URL is not on the Suite origin, so it is not fetched (ask Suite to serve the key on its attachments route)');
  } else if (doc.url) {
    try {
      const res = await fetch(doc.url, { credentials: 'omit' });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        return Ok({ fileName: doc.fileName, contentType: doc.contentType || res.headers.get('content-type') || '', base64: toBase64(buf), sizeBytes: buf.byteLength });
      }
      tried.push(`the signed URL answered ${res.status}`);
    } catch (e) {
      tried.push(`the signed URL could not be read (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return Err('transport', `The document ${doc.key} could not be fetched: ${tried.join('; ') || 'no source'}.`);
}
