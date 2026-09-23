// The runner. Owns RunState, executes a recipe step by step, persists after
// every step to chrome.storage.session, resumes after a worker restart
// without replaying a completed step, and applies the failure taxonomy of
// docs/05. One run at a time.

import { Ok, Err, fromThrown } from '../shared/result.js';
import { SESSION_KEYS, NON_IDEMPOTENT_OPS, TIMEOUTS, LOG_CAP } from '../shared/constants.js';
import { loadForm, findField, orderedFields } from './loader.js';
import { validatePayloadForForm } from '../suite/validate.js';
import { sendOp, triggerJquery, ensureBridge } from './transport.js';
import { lookupValue, selectorsFor } from './context.js';
import { OPS } from './ops/index.js';
import { flag } from './waits.js';
import { valuesMatch, readValue } from './verify.js';

/** @typedef {import('../shared/schema.js').RunState} RunState */
/** @typedef {import('../shared/schema.js').Recipe} Recipe */
/** @typedef {import('../shared/schema.js').FieldMap} FieldMap */
/** @typedef {import('../shared/schema.js').SuitePayload} SuitePayload */
/** @typedef {import('../shared/schema.js').Prepared} Prepared */
/** @typedef {import('../shared/schema.js').LogEntry} LogEntry */
/** @typedef {import('./context.js').OpContext} OpContext */

/**
 * @typedef {object} ActiveRun
 * @property {RunState} state
 * @property {Recipe} recipe
 * @property {OpContext} ctx
 */

/** @type {ActiveRun | null} */
let active = null;
let loopRunning = false;

/* ------------------------------------------------------------------------ */
/* Persistence                                                               */
/* ------------------------------------------------------------------------ */

/**
 * @returns {Promise<RunState | null>}
 */
export async function getRunState() {
  if (active) return active.state;
  const got = await chrome.storage.session.get(SESSION_KEYS.RUN_STATE);
  const v = got[SESSION_KEYS.RUN_STATE];
  return v && typeof v === 'object' ? /** @type {RunState} */ (v) : null;
}

/**
 * @param {RunState} state
 * @returns {Promise<void>}
 */
async function persistState(state) {
  await chrome.storage.session.set({ [SESSION_KEYS.RUN_STATE]: state });
}

/**
 * Forget the run. Called by the worker's reset.
 * @returns {Promise<void>}
 */
export async function clearRunState() {
  if (active && loopRunning) {
    // A loop still holds the old state; make it stop at the next boundary
    // rather than re-persisting a run the panel has cleared.
    active.state.abortRequested = true;
  }
  active = null;
  await chrome.storage.session.remove(SESSION_KEYS.RUN_STATE);
}

/**
 * Whether a run is running or paused right now.
 * @returns {Promise<boolean>}
 */
export async function isRunLive() {
  const state = await getRunState();
  return state !== null && (state.status === 'running' || state.status === 'paused');
}

/**
 * @returns {Promise<SuitePayload | null>}
 */
async function getPayload() {
  const got = await chrome.storage.session.get(SESSION_KEYS.ENGAGEMENT);
  const v = got[SESSION_KEYS.ENGAGEMENT];
  return v && typeof v === 'object' ? /** @type {SuitePayload} */ (v) : null;
}

/**
 * @returns {Promise<Prepared | null>}
 */
async function getPrepared() {
  const got = await chrome.storage.session.get(SESSION_KEYS.PREPARED);
  const v = got[SESSION_KEYS.PREPARED];
  return v && typeof v === 'object' ? /** @type {Prepared} */ (v) : null;
}

/* ------------------------------------------------------------------------ */
/* Context                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * @param {RunState} state
 * @param {Recipe} recipe
 * @param {FieldMap} fieldMap
 * @param {SuitePayload} payload
 * @returns {OpContext}
 */
function buildContext(state, recipe, fieldMap, payload) {
  return {
    runId: state.runId,
    tabId: state.tabId,
    recipe,
    fieldMap,
    payload,
    state,
    send: (op, args, timeoutMs) => sendOp(state.tabId, state.runId, op, args, timeoutMs),
    triggerJquery: (marker, shadowPath) => triggerJquery(state.tabId, marker, shadowPath),
    log: (entry) => appendLog(state, entry),
    persist: () => persistState(state),
    abortRequested: () => state.abortRequested,
    valueFor: (field) => lookupValue(field, payload),
  };
}

/**
 * Append a log entry. Op, label, outcome, duration; never a value.
 * @param {RunState} state
 * @param {Omit<LogEntry, 'at'>} entry
 */
function appendLog(state, entry) {
  state.log.push({ at: new Date().toISOString(), ...entry });
  if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
}

/* ------------------------------------------------------------------------ */
/* Start                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Check every recipe precondition against the tab.
 * @param {Recipe} recipe
 * @param {chrome.tabs.Tab} tab
 * @param {string} runId
 * @returns {Promise<import('../shared/result.js').Result<true>>}
 */
async function checkPreconditions(recipe, tab, runId) {
  const url = tab.url ?? '';
  const tabId = tab.id ?? -1;
  for (const pre of recipe.preconditions) {
    if (pre.op === 'assertUrlMatches') {
      if (!pre.pattern || !new RegExp(pre.pattern).test(url)) {
        return Err('precondition', `${pre.message} (the tab's URL does not match /${pre.pattern ?? ''}/)`);
      }
    } else if (pre.op === 'assertLoggedIn') {
      if (!pre.selector) return Err('validation', 'assertLoggedIn precondition has no selector');
      const r = await sendOp(tabId, runId, 'exists', { selectors: selectorsFor(pre.selector) }, TIMEOUTS.OP_MS);
      if (!r.ok) return r;
      if (!flag(r.value, 'found')) {
        return Err('precondition', `${pre.message} (\`${pre.selector}\` matched 0 elements)`, { selectors: [pre.selector] });
      }
    }
  }
  return Ok(true);
}

/**
 * Start a run for the prepared form on the given tab.
 * @param {{ tabId: number, devMode: boolean }} opts
 * @returns {Promise<import('../shared/result.js').Result<RunState>>}
 */
export async function startRun(opts) {
  const existing = await getRunState();
  if (existing && (existing.status === 'running' || existing.status === 'paused')) {
    return Err('internal', `A run is already ${existing.status}. Stop it before starting another.`);
  }
  const prepared = await getPrepared();
  if (!prepared) return Err('validation', 'No form has been prepared. Go back to Verify.');
  const payload = await getPayload();
  if (!payload) return Err('validation', 'No engagement is loaded. Go back to Import.');

  const loaded = await loadForm(prepared.formId, opts.devMode);
  if (!loaded.ok) return loaded;
  const { recipe, fieldMap } = loaded.value;
  const valid = validatePayloadForForm(payload, prepared.formId, recipe, fieldMap);
  if (!valid.ok) return valid;

  /** @type {chrome.tabs.Tab} */
  let tab;
  try {
    tab = await chrome.tabs.get(opts.tabId);
  } catch {
    return Err('transport', `Tab ${opts.tabId} no longer exists.`);
  }
  const url = tab.url ?? '';
  if (!url.startsWith(recipe.origin)) {
    return Err('precondition', `The active tab is not on ${recipe.origin}. Open the MCA portal in this tab, log in, then start the run.`);
  }

  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ready = await ensureBridge(opts.tabId, runId);
  if (!ready.ok) return ready;
  const pre = await checkPreconditions(recipe, tab, runId);
  if (!pre.ok) return pre;

  /** @type {RunState} */
  const state = {
    runId,
    formId: prepared.formId,
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    fieldMapId: fieldMap.id,
    fieldMapVersion: fieldMap.version,
    engagementId: payload.engagement.id,
    tabId: opts.tabId,
    stepIndex: 0,
    status: 'running',
    startedAt: new Date().toISOString(),
    inFlight: null,
    pause: null,
    stepResults: [],
    steps: recipe.steps.map((s, index) => ({ index, op: s.op, label: s.label ?? (s.op === 'halt' ? 'Stop for review' : s.op) })),
    diff: null,
    error: null,
    log: [],
    abortRequested: false,
    mismatchOverride: false,
    submittedByHuman: false,
    fieldsWritten: 0,
  };
  appendLog(state, { op: 'run', label: `${recipe.label} (recipe v${recipe.version}, map v${fieldMap.version})`, outcome: 'info', ms: 0 });
  active = { state, recipe, ctx: buildContext(state, recipe, fieldMap, payload) };
  await persistState(state);
  void loop();
  return Ok(state);
}

/* ------------------------------------------------------------------------ */
/* Loop                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * @param {RunState} state
 * @param {'halted' | 'failed' | 'aborted'} status
 * @returns {Promise<void>}
 */
async function finish(state, status) {
  state.status = status;
  state.inFlight = null;
  state.endedAt = new Date().toISOString();
  appendLog(state, { op: 'run', label: status, outcome: status === 'halted' ? 'ok' : 'info', ms: 0 });
  await persistState(state);
}

/**
 * Execute steps from `state.stepIndex` until halt, pause, failure or abort.
 * Re-entrant-safe: a second call while one loop runs is a no-op.
 * @returns {Promise<void>}
 */
async function loop() {
  if (loopRunning || !active) return;
  loopRunning = true;
  try {
    const { state, recipe, ctx } = active;
    while (state.status === 'running') {
      if (active === null || active.state !== state) {
        // Cleared from under us; do not touch storage again.
        state.status = 'aborted';
        break;
      }
      if (state.abortRequested) {
        await finish(state, 'aborted');
        break;
      }
      if (state.stepIndex >= recipe.steps.length) {
        await finish(state, 'halted');
        break;
      }
      const index = state.stepIndex;
      const step = recipe.steps[index];
      const label = state.steps[index]?.label ?? step.op;
      state.inFlight = { index, op: step.op, label, startedAt: new Date().toISOString() };
      await persistState(state);

      const started = Date.now();
      /** @type {import('../shared/result.js').Result<import('./context.js').OpOutcome>} */
      let result;
      try {
        result = await OPS[step.op](ctx, step);
      } catch (e) {
        result = fromThrown('internal', e, `Step ${index + 1} "${label}" threw`);
      }
      const ms = Date.now() - started;

      if (!result.ok) {
        if (result.error.class === 'internal' && result.error.message === 'aborted') {
          await finish(state, 'aborted');
          break;
        }
        state.stepResults.push({ index, op: step.op, label, ok: false, ms, error: result.error.message });
        appendLog(state, { op: step.op, label, outcome: 'error', ms, note: result.error.class });
        state.error = { ...result.error, step: result.error.step ?? label, stepIndex: index };
        await finish(state, 'failed');
        break;
      }

      state.stepResults.push({ index, op: step.op, label, ok: true, ms });
      appendLog(state, { op: step.op, label, outcome: 'ok', ms, note: result.value.note });
      state.inFlight = null;
      state.stepIndex = index + 1;

      if (result.value.halt !== undefined) {
        state.haltReason = result.value.halt;
        await finish(state, 'halted');
        break;
      }
      if (result.value.pause) {
        state.pause = result.value.pause;
        state.status = 'paused';
        await persistState(state);
        break;
      }
      await persistState(state);
    }
  } finally {
    loopRunning = false;
  }
}

/* ------------------------------------------------------------------------ */
/* Resume                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Look at the page after a restart interrupted a step, so the lead can
 * decide whether it completed. Booleans and counts only. Any part that
 * cannot be read is reported as unknown, never guessed.
 * @param {OpContext} ctx
 * @param {import('../shared/schema.js').Step} step
 * @returns {Promise<import('../shared/schema.js').InFlightEvidence>}
 */
async function collectInFlightEvidence(ctx, step) {
  /** @type {import('../shared/schema.js').InFlightEvidence} */
  const ev = { url: '', target: null, targetFound: null, holdsExpected: null, matched: null, total: null, note: null };
  const bridge = await ensureBridge(ctx.tabId, ctx.runId);
  if (!bridge.ok) {
    ev.note = `The page could not be inspected: ${bridge.error.message}`;
    return ev;
  }
  const page = await ctx.send('describePage', {}, TIMEOUTS.OP_MS);
  if (page.ok && typeof page.value === 'object' && page.value !== null) {
    const url = /** @type {{ url?: unknown }} */ (page.value).url;
    if (typeof url === 'string') ev.url = url;
  }

  /**
   * @param {import('../shared/schema.js').FieldDef} field
   * @returns {Promise<boolean | null>}
   */
  const holds = async (field) => {
    const lookup = ctx.valueFor(field);
    if (lookup.status !== 'value') return null;
    const read = await ctx.send('readBack', { selectors: field.selectors, field: field.key, type: field.type }, TIMEOUTS.OP_MS);
    if (!read.ok) return null;
    const { actual, alt } = readValue(read.value);
    return valuesMatch(field, lookup.value, actual, alt);
  };

  if (step.op === 'click' && step.selector) {
    ev.target = step.selector;
    const r = await ctx.send('exists', { selectors: selectorsFor(step.selector) }, TIMEOUTS.OP_MS);
    ev.targetFound = r.ok ? flag(r.value, 'found') : null;
    if (!r.ok) ev.note = r.error.message;
  } else if ((step.op === 'fill' || step.op === 'select' || step.op === 'check') && step.key) {
    const found = findField(ctx.fieldMap, step.key);
    if (found) {
      ev.target = found.field.selectors.primary;
      const r = await ctx.send('exists', { selectors: found.field.selectors }, TIMEOUTS.OP_MS);
      ev.targetFound = r.ok ? flag(r.value, 'found') : null;
      if (ev.targetFound) ev.holdsExpected = await holds(found.field);
    }
  } else if (step.op === 'fillGroup' && step.section) {
    let matched = 0;
    let total = 0;
    for (const field of orderedFields(ctx.fieldMap, step.section)) {
      if (ctx.valueFor(field).status !== 'value') continue;
      total += 1;
      if (await holds(field) === true) matched += 1;
    }
    ev.matched = matched;
    ev.total = total;
  }
  return ev;
}

/**
 * Called on every worker wake. If a run was in progress, rebuild the
 * context and continue from `stepIndex`; a paused run is rebuilt but not
 * continued. A step that was in flight when the worker died is re-run only
 * if it is idempotent; otherwise the run pauses and the lead decides whether
 * it completed.
 * @param {boolean} devMode
 * @returns {Promise<void>}
 */
export async function resumeIfNeeded(devMode) {
  if (active) return;
  const state = await getRunState();
  if (!state || (state.status !== 'running' && state.status !== 'paused')) return;
  const payload = await getPayload();
  const loaded = await loadForm(state.formId, devMode);
  if (!payload || !loaded.ok) {
    state.error = loaded.ok
      ? { class: 'internal', message: 'The engagement payload was not found after the worker restarted.' }
      : loaded.error;
    await finish(state, 'failed');
    return;
  }
  const { recipe, fieldMap } = loaded.value;
  active = { state, recipe, ctx: buildContext(state, recipe, fieldMap, payload) };
  if (state.status === 'paused') return; // waiting on the lead; nothing to run yet
  appendLog(state, { op: 'run', label: 'worker restarted; resuming', outcome: 'info', ms: 0 });
  if (state.inFlight && NON_IDEMPOTENT_OPS.includes(state.inFlight.op)) {
    const f = state.inFlight;
    const step = recipe.steps[f.index];
    const evidence = step ? await collectInFlightEvidence(active.ctx, step) : {
      url: '', target: null, targetFound: null, holdsExpected: null, matched: null, total: null, note: 'step not found in recipe',
    };
    state.status = 'paused';
    state.pause = {
      kind: 'inFlight',
      stepIndex: f.index,
      op: f.op,
      label: f.label,
      message: `The extension restarted while step ${f.index + 1} "${f.label}" (${f.op}) was running. It is not replayed automatically: a click may already have navigated, a fill may already be on the page. Look at the evidence and the page, then continue; retry only if it clearly did not happen.`,
      evidence,
    };
    await persistState(state);
    return;
  }
  void loop();
}

/* ------------------------------------------------------------------------ */
/* Controls                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Continue after a humanGate.
 * @returns {Promise<import('../shared/result.js').Result<RunState>>}
 */
export async function continueGate() {
  if (!active) return Err('internal', 'No run is in memory. If the extension restarted, reopen the panel.');
  const { state } = active;
  if (state.status !== 'paused' || !state.pause || state.pause.kind !== 'humanGate') {
    return Err('internal', 'The run is not waiting at a human gate.');
  }
  appendLog(state, { op: 'humanGate', label: 'continued by the lead', outcome: 'info', ms: 0 });
  state.pause = null;
  state.status = 'running';
  await persistState(state);
  void loop();
  return Ok(state);
}

/**
 * Resolve a step that was in flight when the worker restarted. `continue`
 * (the default the panel offers) treats it as completed and moves on;
 * `retry` re-runs it.
 * @param {'continue' | 'retry'} action
 * @returns {Promise<import('../shared/result.js').Result<RunState>>}
 */
export async function resolveInFlight(action) {
  if (!active) return Err('internal', 'No run is in memory. If the extension restarted, reopen the panel.');
  const { state } = active;
  if (state.status !== 'paused' || !state.pause || state.pause.kind !== 'inFlight') {
    return Err('internal', 'The run is not waiting on an interrupted step.');
  }
  const p = state.pause;
  if (action === 'continue') {
    state.stepResults.push({ index: p.stepIndex, op: p.op, label: p.label, ok: true, ms: 0, skipped: true });
    appendLog(state, { op: p.op, label: p.label, outcome: 'skipped', ms: 0, note: 'lead continued past it after the restart' });
    state.stepIndex = p.stepIndex + 1;
  } else {
    appendLog(state, { op: p.op, label: p.label, outcome: 'info', ms: 0, note: 'lead asked to retry after the restart' });
    state.stepIndex = p.stepIndex;
  }
  state.inFlight = null;
  state.pause = null;
  state.status = 'running';
  await persistState(state);
  void loop();
  return Ok(state);
}

/**
 * Stop at the next step boundary (or immediately when paused).
 * @returns {Promise<import('../shared/result.js').Result<RunState | null>>}
 */
export async function abortRun() {
  const state = active ? active.state : await getRunState();
  if (!state) return Ok(null);
  if (state.status === 'running') {
    state.abortRequested = true;
    appendLog(state, { op: 'run', label: 'stop requested; stopping at the next step boundary', outcome: 'info', ms: 0 });
    await persistState(state);
    if (!loopRunning && active) void loop();
    return Ok(state);
  }
  if (state.status === 'paused') {
    state.pause = null;
    await finish(state, 'aborted');
    return Ok(state);
  }
  return Ok(state);
}

/**
 * The lead explicitly accepts the diff's mismatches to proceed to review.
 * @param {boolean} confirmed
 * @returns {Promise<import('../shared/result.js').Result<RunState>>}
 */
export async function setMismatchOverride(confirmed) {
  const state = active ? active.state : await getRunState();
  if (!state) return Err('internal', 'There is no run to override.');
  state.mismatchOverride = confirmed;
  appendLog(state, { op: 'run', label: confirmed ? 'lead accepted the mismatches' : 'lead withdrew the mismatch override', outcome: 'info', ms: 0 });
  await persistState(state);
  return Ok(state);
}

/**
 * Record that the human submitted. Assist never does this itself.
 * @returns {Promise<import('../shared/result.js').Result<RunState>>}
 */
export async function markSubmitted() {
  const state = active ? active.state : await getRunState();
  if (!state) return Err('internal', 'There is no run to mark.');
  if (state.status !== 'halted') return Err('internal', `The run is ${state.status}; only a halted run can be marked as submitted.`);
  state.submittedByHuman = true;
  appendLog(state, { op: 'run', label: 'lead recorded that they submitted', outcome: 'info', ms: 0 });
  await persistState(state);
  return Ok(state);
}
