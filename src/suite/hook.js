// The Suite start hook (docs/gst-profile-contract.md, "Starting from Suite").
// A small content script runs on the configured Suite origin only. It marks
// the page as having VCFO Assist (`data-vcfo-assist`, the version) so Suite
// can show "Start on GST portal" instead of install steps, and it relays a
// start request (`window.postMessage({ source: 'vcfo-suite', type:
// 'vcfo-assist:start', form, engagementId })`, or `?assist=<form>` in the
// URL) to the worker. The worker only records it for preselection: the
// person still opens the panel and presses Start, and nothing runs from a
// page message alone.

import { FORMS, SESSION_KEYS } from '../shared/constants.js';
import { isRecord } from '../shared/check.js';
import { hasOriginPermission } from './client.js';

const SCRIPT_ID = 'va-suite-hook';
const SCRIPT_FILE = 'src/content/suite-hook.js';
/** Message type the hook sends. */
export const SUITE_START = 'va.suite.start';

/**
 * Map a Suite form name to the panel's first form for it.
 * @param {string} form
 * @returns {string | null}
 */
export function panelFormFor(form) {
  if (form === 'gst-reg-01') return 'gst-reg-01-part-a';
  return FORMS.some((f) => f.id === form && f.enabled) ? form : null;
}

/**
 * The form a Suite URL asks for with `?assist=<form>`.
 * @param {string} url
 * @returns {string | null}
 */
export function formFromSuiteUrl(url) {
  try {
    const v = new URL(url).searchParams.get('assist');
    return v ? panelFormFor(v) : null;
  } catch {
    return null;
  }
}

/**
 * (Re)register the hook for the Suite origin. A no-op without host permission
 * for it (the panel asks for permission when the origin is saved).
 * @param {string} origin  '' to unregister
 * @returns {Promise<void>}
 */
export async function registerSuiteHook(origin) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    // Not registered yet.
  }
  if (origin === '' || !(await hasOriginPermission(origin))) return;
  try {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID, matches: [`${origin}/*`], js: [SCRIPT_FILE], runAt: 'document_idle', persistAcrossSessions: true,
    }]);
  } catch {
    // An origin Chrome will not match (it reports why in the extension errors page).
  }
}

/**
 * Whether a runtime message is a start request from a tab on the Suite origin.
 * @param {unknown} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {string} suiteOrigin
 * @returns {boolean}
 */
export function isSuiteStartMessage(message, sender, suiteOrigin) {
  if (!isRecord(message) || message.type !== SUITE_START || suiteOrigin === '' || !sender.tab) return false;
  try {
    return new URL(sender.url ?? '').origin === suiteOrigin;
  } catch {
    return false;
  }
}

/**
 * Record a start request for preselection. Values are ids, not PII.
 * @param {unknown} message
 * @returns {Promise<{ formId: string, engagementId: string | null } | null>}
 */
export async function acceptSuiteStart(message) {
  if (!isRecord(message)) return null;
  const formId = typeof message.form === 'string' ? panelFormFor(message.form) : null;
  if (!formId) return null;
  const engagementId = typeof message.engagementId === 'string' && /^[\w.-]{1,120}$/.test(message.engagementId) ? message.engagementId : null;
  const pending = { formId, engagementId, at: new Date().toISOString() };
  await chrome.storage.session.set({ [SESSION_KEYS.PENDING_START]: pending });
  return pending;
}
