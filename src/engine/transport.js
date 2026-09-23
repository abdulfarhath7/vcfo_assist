// Worker-side transport to the content script. Owns every timeout, so a dead
// content script surfaces as a timeout rather than a hang. Recovers once from
// a mid-run navigation (the content script is destroyed with the document),
// and can inject the content scripts into a tab that was open before the
// extension loaded.

import { Ok, Err, fromThrown } from '../shared/result.js';
import { CONTENT_MSG, TIMEOUTS } from '../shared/constants.js';

/** @typedef {import('../shared/schema.js').ContentOp} ContentOp */
/** @typedef {import('../shared/schema.js').ContentRequest} ContentRequest */
/** @typedef {import('../shared/schema.js').ContentResponse} ContentResponse */

/** Content script files, in manifest order, for programmatic injection. */
const CONTENT_FILES = Object.freeze([
  'src/content/lib/resolve.js',
  'src/content/lib/observe.js',
  'src/content/lib/setvalue.js',
  'src/content/bridge.js',
]);

/**
 * @param {unknown} e
 * @returns {boolean}
 */
function isReceiverGone(e) {
  const msg = e instanceof Error ? e.message : String(e);
  return /Receiving end does not exist|Could not establish connection|message port closed/i.test(msg);
}

/**
 * Wait until a tab reports `status: "complete"`. Resolves immediately when it
 * already has.
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<import('../shared/result.js').Result<true>>}
 */
export function waitForTabComplete(tabId, timeoutMs = TIMEOUTS.TAB_SETTLE_MS) {
  return new Promise((resolve) => {
    let done = false;
    /**
     * @param {number} id
     * @param {chrome.tabs.OnUpdatedInfo} info
     */
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(Ok(true));
    };
    /** @param {number} id */
    const onRemoved = (id) => {
      if (id === tabId) finish(Err('transport', `Tab ${tabId} was closed during the run.`));
    };
    /** @param {import('../shared/result.js').Result<true>} r */
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(r);
    };
    const timer = setTimeout(() => finish(Err('timeout', `Tab ${tabId} did not finish loading within ${timeoutMs / 1000}s.`, { elapsedMs: timeoutMs })), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish(Ok(true));
    }).catch(() => finish(Err('transport', `Tab ${tabId} no longer exists.`)));
  });
}

/**
 * Inject the content scripts into a tab that has none (opened before the
 * extension was loaded). The bridge guards against double installation.
 * @param {number} tabId
 * @returns {Promise<import('../shared/result.js').Result<true>>}
 */
export async function injectContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [...CONTENT_FILES], world: 'ISOLATED' });
    return Ok(true);
  } catch (e) {
    return fromThrown('transport', e, `Could not inject the content script into tab ${tabId}`);
  }
}

/** How long a live bridge gets to answer the readiness handshake. */
const HANDSHAKE_MS = 3000;

/**
 * Readiness handshake. Pings the bridge with the runId and accepts only a
 * reply that echoes it, so a stale frame or another extension's listener
 * cannot pass for a live bridge.
 * @param {number} tabId
 * @param {string} runId
 * @returns {Promise<boolean>}
 */
export async function handshake(tabId, runId) {
  /** @type {ContentRequest} */
  const request = { type: CONTENT_MSG.OP, runId, op: 'ping', args: { runId } };
  const r = await sendOnce(tabId, request, HANDSHAKE_MS);
  if (r.kind !== 'response' || !r.response || r.response.ok !== true) return false;
  const v = r.response.value;
  return typeof v === 'object' && v !== null
    && /** @type {{ runId?: unknown }} */ (v).runId === runId
    && /** @type {{ ready?: unknown }} */ (v).ready === true;
}

/**
 * Make sure a live bridge answers in the tab. Waits for the document to
 * finish loading first, so a content script that is merely slow (manifest
 * injection runs at document_idle) is not injected a second time. Injects
 * only when the handshake still fails after that.
 * @param {number} tabId
 * @param {string} runId
 * @returns {Promise<import('../shared/result.js').Result<{ injected: boolean }>>}
 */
export async function ensureBridge(tabId, runId) {
  const settled = await waitForTabComplete(tabId);
  if (!settled.ok) return settled;
  if (await handshake(tabId, runId)) return Ok({ injected: false });
  const injected = await injectContentScripts(tabId);
  if (!injected.ok) return injected;
  if (await handshake(tabId, runId)) return Ok({ injected: true });
  return Err('transport', `The content script does not answer in tab ${tabId} even after injection. Reload the MCA tab and try again.`);
}

/**
 * One raw send with a worker-owned timeout.
 * @param {number} tabId
 * @param {ContentRequest} request
 * @param {number} timeoutMs
 * @returns {Promise<{ kind: 'response', response: ContentResponse } | { kind: 'gone', error: string } | { kind: 'timeout' } | { kind: 'error', error: string }>}
 */
async function sendOnce(tabId, request, timeoutMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  const send = chrome.tabs.sendMessage(tabId, request)
    .then((response) => ({ kind: 'response', response: /** @type {ContentResponse} */ (response) }))
    .catch((e) => (isReceiverGone(e)
      ? { kind: 'gone', error: e instanceof Error ? e.message : String(e) }
      : { kind: 'error', error: e instanceof Error ? e.message : String(e) }));
  const outcome = await Promise.race([send, timeout]);
  clearTimeout(timer);
  return /** @type {any} */ (outcome);
}

/**
 * Send one op to the content script in the run's tab. On a missing receiver,
 * waits for the tab to settle, injects the scripts if needed, and re-sends
 * once. Two consecutive failures fail the op with a transport error.
 * @param {number} tabId
 * @param {string} runId
 * @param {ContentOp} op
 * @param {Record<string, unknown>} args
 * @param {number} [timeoutMs]
 * @returns {Promise<import('../shared/result.js').Result<unknown>>}
 */
export async function sendOp(tabId, runId, op, args, timeoutMs = TIMEOUTS.OP_MS) {
  /** @type {ContentRequest} */
  const request = { type: CONTENT_MSG.OP, runId, op, args };
  const first = await sendOnce(tabId, request, timeoutMs);
  if (first.kind === 'response') return unwrap(first.response, op);
  if (first.kind === 'timeout') {
    return Err('timeout', `Content script did not answer op "${op}" within ${timeoutMs / 1000}s.`, { elapsedMs: timeoutMs });
  }
  if (first.kind === 'error') {
    return Err('transport', `Sending op "${op}" to tab ${tabId} failed: ${first.error}`);
  }

  // Receiver gone: the tab navigated or never had the script. Settle,
  // handshake (inject only if that fails), then retry the op once.
  const ready = await ensureBridge(tabId, runId);
  if (!ready.ok) return ready;
  const second = await sendOnce(tabId, request, timeoutMs);
  if (second.kind === 'response') return unwrap(second.response, op);
  if (second.kind === 'timeout') {
    return Err('timeout', `Content script did not answer op "${op}" within ${timeoutMs / 1000}s after the tab reloaded.`, { elapsedMs: timeoutMs });
  }
  return Err('transport', `Content script unreachable in tab ${tabId} after one retry (op "${op}"): ${second.error}`);
}

/**
 * @param {ContentResponse | undefined} response
 * @param {string} op
 * @returns {import('../shared/result.js').Result<unknown>}
 */
function unwrap(response, op) {
  if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    return Err('transport', `Content script returned no reply for op "${op}" (the receiver may be a stale frame).`);
  }
  if (response.ok) return Ok(response.value);
  return { ok: false, error: response.error };
}

/**
 * Trigger the page's own jQuery handlers on the marked element. Runs in the
 * MAIN world because the isolated world cannot see `window.jQuery`. A page
 * without jQuery is a no-op, reported as `triggered: false`.
 * @param {number} tabId
 * @param {string} marker
 * @param {string[]} shadowPath
 * @returns {Promise<import('../shared/result.js').Result<{ triggered: boolean }>>}
 */
export async function triggerJquery(tabId, marker, shadowPath) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: mainWorldTrigger,
      args: [marker, shadowPath],
    });
    const first = results[0];
    const value = first && typeof first.result === 'object' && first.result !== null ? first.result : null;
    const triggered = value !== null && /** @type {{ triggered?: unknown }} */ (value).triggered === true;
    return Ok({ triggered });
  } catch (e) {
    return fromThrown('transport', e, 'MAIN-world jQuery trigger failed');
  }
}

/**
 * Executed in the page's MAIN world. Must be self-contained: no closures over
 * worker scope. Finds the marked element (through open shadow roots) and
 * triggers jQuery's handlers for the events a typed edit would raise.
 * @param {string} marker
 * @param {string[]} shadowPath
 * @returns {{ triggered: boolean, found: boolean }}
 */
function mainWorldTrigger(marker, shadowPath) {
  /** @type {Document | ShadowRoot} */
  let root = document;
  for (const hostSelector of shadowPath) {
    /** @type {Element | null} */
    const host = root.querySelector(hostSelector);
    if (!host || !host.shadowRoot) return { triggered: false, found: false };
    root = host.shadowRoot;
  }
  const el = root.querySelector(`[data-va-mark="${marker}"]`);
  if (!el) return { triggered: false, found: false };
  const w = /** @type {any} */ (window);
  const jq = typeof w.jQuery === 'function' ? w.jQuery : (typeof w.$ === 'function' && w.$.fn ? w.$ : null);
  if (!jq || !jq.fn) return { triggered: false, found: true };
  try {
    const $el = jq(el);
    $el.trigger('keydown').trigger('keyup').trigger('input').trigger('change').trigger('blur');
    return { triggered: true, found: true };
  } catch {
    return { triggered: false, found: true };
  }
}
