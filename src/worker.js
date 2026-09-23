// VCFO Assist — service worker (ES module). Run orchestration, Suite API
// client, session state, and the panel's request handler. Engagement data
// lives in chrome.storage.session only; preferences in chrome.storage.local.

import { Ok, Err } from './shared/result.js';
import { ASSIST_VERSION, SESSION_KEYS, LOCAL_KEYS, MSG, FORMS, TIMEOUTS, NAVIGATE_ORIGIN } from './shared/constants.js';
import { isRecord } from './shared/check.js';
import { loadForm, loadResultRecipe, orderedFields } from './engine/loader.js';
import { lookupValue, selectorsFor } from './engine/context.js';
import { sendOp, ensureBridge } from './engine/transport.js';
import { flag } from './engine/waits.js';
import * as runner from './engine/runner.js';
import {
  getSuiteOrigin, setSuiteOrigin, normaliseOrigin, fetchAssistProfile,
  loadFixture, postResult, detectSuiteEngagement,
} from './suite/client.js';
import { validatePayloadShape, validatePayloadForForm, checkPayloadExpiry } from './suite/validate.js';
import { validateProfileResponse, payloadFromProfile, looksLikeProfileResponse } from './suite/profile.js';
import { parseEnvelope, decryptBundle } from './suite/bundle.js';

/** @typedef {import('./shared/schema.js').PanelRequest} PanelRequest */
/** @typedef {import('./shared/schema.js').PanelResponse} PanelResponse */
/** @typedef {import('./shared/schema.js').PanelSnapshot} PanelSnapshot */
/** @typedef {import('./shared/schema.js').SuitePayload} SuitePayload */
/** @typedef {import('./shared/schema.js').EngagementSource} EngagementSource */
/** @typedef {import('./shared/schema.js').VerifyRow} VerifyRow */
/** @typedef {import('./shared/schema.js').Prepared} Prepared */
/** @typedef {import('./shared/schema.js').CapturedResult} CapturedResult */
/** @typedef {import('./shared/schema.js').SuiteResult} SuiteResult */

/* ------------------------------------------------------------------------ */
/* Preferences                                                               */
/* ------------------------------------------------------------------------ */

/** @returns {Promise<boolean>} */
async function getDevMode() {
  const got = await chrome.storage.local.get(LOCAL_KEYS.DEV_MODE);
  return got[LOCAL_KEYS.DEV_MODE] === true;
}

/** @returns {boolean} */
function isUnpacked() {
  return !('update_url' in chrome.runtime.getManifest());
}

/* ------------------------------------------------------------------------ */
/* Session helpers                                                           */
/* ------------------------------------------------------------------------ */

/**
 * @template T
 * @param {string} key
 * @returns {Promise<T | null>}
 */
async function sessionGet(key) {
  const got = await chrome.storage.session.get(key);
  const v = got[key];
  return v === undefined || v === null ? null : /** @type {T} */ (v);
}

/**
 * Forget everything about the current engagement and run.
 * @returns {Promise<void>}
 */
async function clearSession() {
  await runner.clearRunState();
  await chrome.storage.session.remove(Object.values(SESSION_KEYS));
}

/**
 * Store a validated payload and drop anything derived from a previous one.
 * @param {SuitePayload} payload
 * @param {EngagementSource} source
 * @returns {Promise<void>}
 */
async function storeEngagement(payload, source) {
  await clearSession();
  await chrome.storage.session.set({
    [SESSION_KEYS.ENGAGEMENT]: payload,
    [SESSION_KEYS.ENGAGEMENT_SOURCE]: source,
  });
}

/* ------------------------------------------------------------------------ */
/* Snapshot                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * @returns {Promise<PanelSnapshot>}
 */
async function snapshot() {
  const [origin, devMode, local, payload, source, prepared, verifyRows, run, captured] = await Promise.all([
    getSuiteOrigin(),
    getDevMode(),
    chrome.storage.local.get(LOCAL_KEYS.LAST_FORM),
    sessionGet(SESSION_KEYS.ENGAGEMENT),
    sessionGet(SESSION_KEYS.ENGAGEMENT_SOURCE),
    sessionGet(SESSION_KEYS.PREPARED),
    sessionGet(SESSION_KEYS.VERIFY_ROWS),
    runner.getRunState(),
    sessionGet(SESSION_KEYS.CAPTURED_RESULT),
  ]);
  const p = /** @type {SuitePayload | null} */ (payload);
  const lastForm = local[LOCAL_KEYS.LAST_FORM];
  return {
    version: ASSIST_VERSION,
    suiteOrigin: origin,
    devMode,
    unpacked: isUnpacked(),
    engagementSource: /** @type {EngagementSource | null} */ (source),
    engagement: p ? p.engagement : null,
    missing: p?.missing ?? [],
    notes: p?.notes ?? [],
    lastForm: typeof lastForm === 'string' ? lastForm : null,
    prepared: /** @type {Prepared | null} */ (prepared),
    verifyRows: /** @type {VerifyRow[] | null} */ (verifyRows),
    run,
    captured: /** @type {CapturedResult | null} */ (captured),
    forms: FORMS.map((f) => ({ id: f.id, label: f.label, enabled: f.enabled })),
  };
}

/* ------------------------------------------------------------------------ */
/* Engagement loading                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Validate a raw payload from any path and store it.
 * @param {unknown} raw
 * @param {EngagementSource} source
 * @param {string} formId
 * @returns {Promise<PanelResponse>}
 */
async function acceptPayload(raw, source, formId) {
  const shaped = validatePayloadShape(raw);
  if (!shaped.ok) return shaped;
  const payload = shaped.value;
  if (payload.form !== formId) {
    return Err('validation', `The payload is for form "${payload.form}" but "${formId}" was selected.`);
  }
  const fresh = checkPayloadExpiry(payload);
  if (!fresh.ok) return fresh;
  await storeEngagement(payload, source);
  return Ok({ engagement: payload.engagement, source });
}

/**
 * Validate a Suite assist-profile response, bind it to flat fields and store
 * it. `mcaLogin` is refused if it carries anything and never stored.
 * @param {unknown} raw
 * @param {EngagementSource} source
 * @param {{ formId: string, engagementId: string, from: string }} ctx
 * @returns {Promise<PanelResponse>}
 */
async function acceptProfile(raw, source, ctx) {
  const checked = validateProfileResponse(raw, ctx.from);
  if (!checked.ok) return checked;
  const payload = payloadFromProfile(checked.value, { engagementId: ctx.engagementId, formId: ctx.formId });
  await storeEngagement(payload, source);
  return Ok({ engagement: payload.engagement, source, missing: payload.missing?.length ?? 0 });
}

/**
 * @param {Extract<PanelRequest, { type: 'va.loadEngagement' }>} req
 * @returns {Promise<PanelResponse>}
 */
async function loadEngagement(req) {
  if (req.source === 'bundle') {
    const envelope = parseEnvelope(req.envelope);
    if (!envelope.ok) return envelope;
    if (envelope.value.manifest.form !== req.formId) {
      return Err('validation', `The bundle is for form "${envelope.value.manifest.form}" but "${req.formId}" was selected.`);
    }
    const plain = await decryptBundle(envelope.value, req.passphrase);
    if (!plain.ok) return plain;
    if (looksLikeProfileResponse(plain.value)) {
      return acceptProfile(plain.value, 'bundle', {
        formId: req.formId, engagementId: envelope.value.manifest.engagementId, from: 'the bundle',
      });
    }
    const accepted = await acceptPayload(plain.value, 'bundle', req.formId);
    if (!accepted.ok) return accepted;
    const stored = await sessionGet(SESSION_KEYS.ENGAGEMENT);
    const payload = /** @type {SuitePayload | null} */ (stored);
    if (payload && payload.engagement.id !== envelope.value.manifest.engagementId) {
      await clearSession();
      return Err('validation', 'The bundle manifest names a different engagement than its contents.');
    }
    return accepted;
  }
  const origin = await getSuiteOrigin();
  if (origin === '' || req.source === 'fixture') {
    const fixture = await loadFixture();
    if (!fixture.ok) return fixture;
    return acceptProfile(fixture.value, 'fixture', { formId: req.formId, engagementId: 'fixture', from: 'the development fixture' });
  }
  const engagementId = (req.engagementId ?? '').trim();
  if (!engagementId) return Err('validation', 'Open the engagement in VCFO Suite, or enter its id or slug.');
  const raw = await fetchAssistProfile(origin, engagementId);
  if (!raw.ok) return raw;
  return acceptProfile(raw.value, 'suite', { formId: req.formId, engagementId, from: origin });
}

/* ------------------------------------------------------------------------ */
/* The one button: Start SPICe+ Part A                                        */
/* ------------------------------------------------------------------------ */

const PART_A = 'spice-part-a';

/**
 * Bring the MCA portal forward: the open MCA tab, or a new active one. The
 * lead logs in there; Assist never does.
 * @returns {Promise<import('./shared/result.js').Result<number>>}
 */
async function openMcaTab() {
  try {
    const [existing] = await chrome.tabs.query({ url: `${NAVIGATE_ORIGIN}/*` });
    if (existing && typeof existing.id === 'number') {
      await chrome.tabs.update(existing.id, { active: true });
      if (typeof existing.windowId === 'number') await chrome.windows.update(existing.windowId, { focused: true });
      return Ok(existing.id);
    }
    const tab = await chrome.tabs.create({ url: `${NAVIGATE_ORIGIN}/`, active: true });
    if (typeof tab.id !== 'number') return Err('transport', `Could not open ${NAVIGATE_ORIGIN}.`);
    return Ok(tab.id);
  } catch (e) {
    return Err('transport', `Could not open ${NAVIGATE_ORIGIN}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Steps 1–2 of the one-button flow: load the profile (the engagement open in
 * Suite unless one is given), prepare Part A, and open MCA for the lead to log
 * in. The run itself starts when the lead presses Continue (START_RUN).
 * @param {string | undefined} typedId
 * @returns {Promise<PanelResponse>}
 */
async function startPartA(typedId) {
  const origin = await getSuiteOrigin();
  let engagementId = (typedId ?? '').trim();
  const loadedAlready = /** @type {SuitePayload | null} */ (await sessionGet(SESSION_KEYS.ENGAGEMENT));
  if (!engagementId && loadedAlready) {
    // Loaded and confirmed by name on panel 1: start it as it is.
    const prepared = await prepareForm(PART_A);
    if (!prepared.ok) return prepared;
    const mca = await openMcaTab();
    if (!mca.ok) return mca;
    return Ok({ mcaTabId: mca.value });
  }
  if (origin !== '' && !engagementId) {
    const open = await detectSuiteEngagement(origin);
    if (!open) return Err('validation', `No engagement is open in a ${origin} tab. Open it in VCFO Suite, or enter its id or slug.`);
    engagementId = open.engagementId;
  }
  const loaded = await loadEngagement({
    type: MSG.LOAD_ENGAGEMENT, source: origin === '' ? 'fixture' : 'suite', formId: PART_A, engagementId,
  });
  if (!loaded.ok) return loaded;
  const prepared = await prepareForm(PART_A);
  if (!prepared.ok) return prepared;
  const mca = await openMcaTab();
  if (!mca.ok) return mca;
  return Ok({ mcaTabId: mca.value });
}

/* ------------------------------------------------------------------------ */
/* Prepare (panel 2)                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Load recipe and map, validate the payload against them, and build the
 * verify rows. The rows carry values; they live in session storage and are
 * shown only in panel 2.
 * @param {string} formId
 * @returns {Promise<PanelResponse>}
 */
async function prepareForm(formId) {
  const form = FORMS.find((f) => f.id === formId);
  if (!form) return Err('validation', `Unknown form "${formId}".`);
  if (!form.enabled) return Err('validation', `${form.label} is not enabled in this build.`);
  const payload = /** @type {SuitePayload | null} */ (await sessionGet(SESSION_KEYS.ENGAGEMENT));
  if (!payload) return Err('validation', 'No engagement is loaded.');
  const devMode = await getDevMode();
  const loaded = await loadForm(formId, devMode);
  if (!loaded.ok) return loaded;
  const { recipe, fieldMap } = loaded.value;
  const valid = validatePayloadForForm(payload, formId, recipe, fieldMap);
  if (!valid.ok) return valid;
  const warnings = valid.value.warnings;

  /** @type {VerifyRow[]} */
  const rows = [];
  /** @type {string[]} */
  const fragileKeys = [];
  let fillableCount = 0;
  let unboundCount = 0;
  for (const section of Object.keys(fieldMap.sections)) {
    for (const field of orderedFields(fieldMap, section)) {
      // Captured but not bound to a profile value: nothing to verify, never filled.
      if (field.sourceField === null) {
        unboundCount += 1;
        continue;
      }
      const lookup = lookupValue(field, payload);
      if (field.selectors.stability === 'fragile') fragileKeys.push(field.key);
      /** @type {VerifyRow} */
      const row = {
        key: field.key,
        label: field.label,
        sourceField: field.sourceField,
        section,
        value: null,
        hasValue: false,
        optional: field.optional,
        stability: field.selectors.stability,
        entryMode: field.entry.mode,
        maxLength: field.maxLength,
        warning: null,
        note: field.note ?? null,
      };
      switch (lookup.status) {
        case 'value':
          row.value = lookup.value;
          row.hasValue = true;
          fillableCount += 1;
          break;
        case 'tooLong':
          row.value = lookup.value;
          row.hasValue = true;
          row.warning = `${lookup.value.length} characters; the field allows ${lookup.maxLength}. It will not be filled.`;
          break;
        case 'error':
          row.warning = lookup.message;
          break;
        case 'missing':
          break;
      }
      rows.push(row);
    }
  }
  /** @type {Prepared} */
  const prepared = {
    formId,
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    recipeLabel: recipe.label,
    fieldMapId: fieldMap.id,
    fieldMapVersion: fieldMap.version,
    engagementId: payload.engagement.id,
    fragileKeys,
    warnings,
    fillableCount,
    unboundCount,
    steps: recipe.steps.map((s, index) => ({ index, op: s.op, label: s.label ?? (s.op === 'halt' ? 'Stop for review' : s.op) })),
  };
  await chrome.storage.session.set({
    [SESSION_KEYS.PREPARED]: prepared,
    [SESSION_KEYS.VERIFY_ROWS]: rows,
  });
  await chrome.storage.local.set({ [LOCAL_KEYS.LAST_FORM]: formId });
  return Ok(prepared);
}

/* ------------------------------------------------------------------------ */
/* Return leg (panel 5)                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Read the SRN and status from the page per the result recipe.
 * @param {number} tabId
 * @returns {Promise<PanelResponse>}
 */
async function captureResult(tabId) {
  const run = await runner.getRunState();
  if (!run) return Err('validation', 'There is no run to capture a result for.');
  if (run.status !== 'halted') return Err('validation', `The run is ${run.status}; capture after the fill has halted and you have submitted.`);
  const devMode = await getDevMode();
  const loaded = await loadResultRecipe(run.formId, devMode);
  if (!loaded.ok) return loaded;
  const rr = loaded.value.resultRecipe;

  /** @type {chrome.tabs.Tab} */
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return Err('transport', `Tab ${tabId} no longer exists.`);
  }
  const url = tab.url ?? '';
  if (!url.startsWith(rr.origin)) {
    return Err('precondition', `The active tab is not on ${rr.origin}. Open the MCA page that shows the SRN.`);
  }
  for (const pre of rr.preconditions) {
    if (pre.op === 'assertUrlMatches' && pre.pattern && !new RegExp(pre.pattern).test(url)) {
      return Err('precondition', pre.message);
    }
  }
  const captureId = `cap_${Date.now().toString(36)}`;
  const bridge = await ensureBridge(tabId, captureId);
  if (!bridge.ok) return bridge;
  for (const pre of rr.preconditions) {
    if (pre.op === 'assertLoggedIn' && pre.selector) {
      const r = await sendOp(tabId, captureId, 'exists', { selectors: selectorsFor(pre.selector) }, TIMEOUTS.OP_MS);
      if (!r.ok) return r;
      if (!flag(r.value, 'found')) return Err('precondition', `${pre.message} (\`${pre.selector}\` matched 0 elements)`);
    }
  }

  /** @type {Record<string, string>} */
  const values = {};
  for (const f of rr.extract) {
    const r = await sendOp(tabId, captureId, 'readText', {
      selectors: f.selectors, field: f.key, read: f.read, attribute: f.attribute ?? '',
    }, TIMEOUTS.OP_MS);
    if (!r.ok) {
      if (f.optional) continue;
      return r;
    }
    const text = isRecord(r.value) && typeof r.value.text === 'string' ? r.value.text : '';
    let out = text;
    if (f.pattern) {
      const m = new RegExp(f.pattern).exec(text);
      if (!m) {
        if (f.optional) continue;
        return Err('verification', `field \`${f.key}\`: the page text did not match /${f.pattern}/`, { field: f.key });
      }
      out = m[1] ?? m[0];
    }
    if (out.trim() === '' && !f.optional) {
      return Err('verification', `field \`${f.key}\`: the element was found but holds no text`, { field: f.key });
    }
    values[f.key] = out.trim();
  }
  const srn = values.srn;
  if (!srn) return Err('verification', 'No SRN was read from the page.');

  /** @type {SuiteResult} */
  const result = {
    form: run.formId,
    srn,
    status: values.status ?? (run.submittedByHuman ? 'submitted' : 'unknown'),
    capturedAt: new Date().toISOString(),
    fieldsWritten: run.fieldsWritten,
    mismatches: run.diff ? run.diff.mismatches : [],
    recipeVersion: run.recipeVersion,
    fieldMapVersion: run.fieldMapVersion,
  };
  /** @type {CapturedResult} */
  const captured = { engagementId: run.engagementId, result, posted: false };
  await chrome.storage.session.set({ [SESSION_KEYS.CAPTURED_RESULT]: captured });
  return Ok(captured);
}

/**
 * Post the captured result to Suite. On success the engagement payload is
 * cleared from session storage (docs/07); the captured result stays until
 * the lead resets.
 * @returns {Promise<PanelResponse>}
 */
async function postCaptured() {
  const captured = /** @type {CapturedResult | null} */ (await sessionGet(SESSION_KEYS.CAPTURED_RESULT));
  if (!captured) return Err('validation', 'Read the SRN from the page first.');
  const origin = await getSuiteOrigin();
  const source = /** @type {EngagementSource | null} */ (await sessionGet(SESSION_KEYS.ENGAGEMENT_SOURCE));
  if (origin === '' || source === 'fixture') {
    return Err('validation', 'No VCFO Suite origin is configured (development fixture in use), so there is nowhere to send the result. Set the Suite origin in Import to enable this.');
  }
  const posted = await postResult(origin, captured.engagementId, captured.result);
  if (!posted.ok) return posted;
  captured.posted = true;
  captured.postedAt = new Date().toISOString();
  await chrome.storage.session.set({ [SESSION_KEYS.CAPTURED_RESULT]: captured });
  await chrome.storage.session.remove([SESSION_KEYS.ENGAGEMENT, SESSION_KEYS.VERIFY_ROWS]);
  return Ok(captured);
}

/* ------------------------------------------------------------------------ */
/* Request handling                                                          */
/* ------------------------------------------------------------------------ */

/** Resolves once the resume check for this worker instance has finished. */
const resumed = getDevMode().then((devMode) => runner.resumeIfNeeded(devMode)).catch(() => undefined);

/**
 * @param {PanelRequest} req
 * @returns {Promise<PanelResponse>}
 */
async function handle(req) {
  await resumed;
  switch (req.type) {
    case MSG.GET_STATE:
      return Ok(await snapshot());
    case MSG.SET_SUITE_ORIGIN: {
      const n = normaliseOrigin(req.origin);
      if (!n.ok) return n;
      await setSuiteOrigin(n.value);
      return Ok({ origin: n.value });
    }
    case MSG.SET_DEV_MODE:
      if (!isUnpacked() && req.devMode) return Err('validation', 'Development mode is only available for an unpacked build.');
      await chrome.storage.local.set({ [LOCAL_KEYS.DEV_MODE]: req.devMode });
      return Ok({ devMode: req.devMode });
    case MSG.LOAD_ENGAGEMENT:
      if (await runner.isRunLive()) return Err('internal', 'A run is in progress. Stop it before loading another engagement.');
      return loadEngagement(req);
    case MSG.DETECT_SUITE_ENGAGEMENT:
      return Ok(await detectSuiteEngagement(await getSuiteOrigin()));
    case MSG.START_PART_A:
      if (await runner.isRunLive()) return Err('internal', 'A run is in progress. Stop it before starting another.');
      return startPartA(req.engagementId);
    case MSG.PREPARE_FORM:
      return prepareForm(req.formId);
    case MSG.START_RUN:
      return runner.startRun({ tabId: req.tabId, devMode: await getDevMode() });
    case MSG.CONTINUE_GATE:
      return runner.continueGate();
    case MSG.RESOLVE_IN_FLIGHT:
      return runner.resolveInFlight(req.action);
    case MSG.ABORT_RUN:
      return runner.abortRun();
    case MSG.OVERRIDE_MISMATCHES:
      return runner.setMismatchOverride(req.confirmed);
    case MSG.MARK_SUBMITTED:
      return runner.markSubmitted();
    case MSG.CAPTURE_RESULT:
      return captureResult(req.tabId);
    case MSG.POST_RESULT:
      return postCaptured();
    case MSG.RESET:
      if (await runner.isRunLive()) return Err('internal', 'A run is in progress. Stop it first; Stop aborts at the next step boundary.');
      await clearSession();
      return Ok(true);
    default:
      return Err('internal', `Unknown request type "${/** @type {{ type?: string }} */ (req).type ?? ''}".`);
  }
}

/**
 * @param {unknown} v
 * @returns {v is PanelRequest}
 */
function isPanelRequest(v) {
  return isRecord(v) && typeof v.type === 'string' && v.type.startsWith('va.') && v.type !== 'va.op';
}

chrome.runtime.onMessage.addListener(
  /**
   * @param {unknown} message
   * @param {chrome.runtime.MessageSender} sender
   * @param {(response: PanelResponse) => void} sendResponse
   * @returns {boolean | undefined}
   */
  (message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return undefined;
    if (!isPanelRequest(message)) return undefined;
    handle(message)
      .then(sendResponse)
      .catch((e) => sendResponse(Err('internal', e instanceof Error ? e.message : String(e))));
    return true;
  },
);

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
