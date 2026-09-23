// VCFO Assist side panel shell (ES module). Header, progress rail, view
// routing between the five panels, the persistent error slot and the Stop
// control. Views live in ./views/*.js. The panel talks to the worker with
// chrome.runtime.sendMessage and watches chrome.storage.session for live run
// state, so it survives worker restarts.

import { MSG, SESSION_KEYS, STAGES } from '../shared/constants.js';
import { Ok, Err } from '../shared/result.js';
import { h, replace, icon } from './dom.js';
import * as importView from './views/import.js';
import * as verifyView from './views/verify.js';
import * as autofillView from './views/autofill.js';
import * as gateView from './views/human-gate.js';
import * as captureView from './views/capture.js';

/** @typedef {import('../shared/schema.js').PanelSnapshot} PanelSnapshot */
/** @typedef {import('../shared/schema.js').PanelRequest} PanelRequest */
/** @typedef {import('../shared/schema.js').AssistError} AssistError */
/** @typedef {import('../shared/schema.js').RunState} RunState */
/** @typedef {import('./context.js').Stage} Stage */
/** @typedef {import('./context.js').UiState} UiState */
/** @typedef {import('./context.js').ViewContext} ViewContext */
/** @typedef {import('./context.js').View} View */

/** @type {Readonly<Record<Stage, View>>} */
const VIEWS = Object.freeze({
  import: importView,
  verify: verifyView,
  autofill: autofillView,
  gate: gateView,
  capture: captureView,
});

/** @type {Readonly<Record<Stage, string>>} */
const STAGE_LABELS = Object.freeze({
  import: 'Import',
  verify: 'Verify',
  autofill: 'Autofill',
  gate: 'Sign, pay, file',
  capture: 'Capture and return',
});

/** @type {PanelSnapshot | null} */
let snap = null;

/** @type {UiState} */
const ui = { stage: 'import', busy: false, error: null, stopping: false };

const els = {
  version: /** @type {HTMLElement} */ (document.getElementById('hdr-version')),
  origin: /** @type {HTMLElement} */ (document.getElementById('hdr-origin')),
  rail: /** @type {HTMLElement} */ (document.getElementById('rail')),
  view: /** @type {HTMLElement} */ (document.getElementById('view')),
  error: /** @type {HTMLElement} */ (document.getElementById('error')),
  stop: /** @type {HTMLButtonElement} */ (document.getElementById('stop')),
  primary: /** @type {HTMLButtonElement} */ (document.getElementById('primary')),
};

/* ------------------------------------------------------------------------ */
/* Worker messaging                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Send a request to the worker. A missing or malformed reply is a named
 * transport error, never a hang.
 * @param {PanelRequest} req
 * @returns {Promise<import('../shared/result.js').Result<unknown>>}
 */
async function request(req) {
  try {
    const reply = await chrome.runtime.sendMessage(req);
    if (reply && typeof reply === 'object' && typeof reply.ok === 'boolean') {
      return /** @type {import('../shared/result.js').Result<unknown>} */ (reply);
    }
    return Err('transport', `The service worker gave no reply to ${req.type}. Reload the extension.`);
  } catch (e) {
    return Err('transport', `Could not reach the service worker: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Re-fetch the snapshot and re-render.
 * @returns {Promise<void>}
 */
async function refresh() {
  const r = await request({ type: MSG.GET_STATE });
  if (!r.ok) {
    setError(r.error);
    return;
  }
  snap = /** @type {PanelSnapshot} */ (r.value);
  clampStage();
  render();
}

/**
 * The active tab in this window — the MCA tab beside the panel.
 * @returns {Promise<import('../shared/result.js').Result<number>>}
 */
async function activeTabId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || typeof tab.id !== 'number') return Err('precondition', 'No active tab in this window.');
    return Ok(tab.id);
  } catch (e) {
    return Err('transport', `Could not read the active tab: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* ------------------------------------------------------------------------ */
/* Stage logic                                                               */
/* ------------------------------------------------------------------------ */

/**
 * The furthest stage the current state allows.
 * @param {PanelSnapshot} s
 * @returns {Stage}
 */
function maxStage(s) {
  if (s.captured || (s.run && s.run.status === 'halted' && s.run.submittedByHuman)) return 'capture';
  if (s.run && s.run.status === 'halted') {
    const mismatches = s.run.diff ? s.run.diff.mismatches.length : 0;
    return mismatches === 0 || s.run.mismatchOverride ? 'gate' : 'autofill';
  }
  if (s.run) return 'autofill';
  if (s.prepared && s.verifyRows && s.engagement) return 'verify';
  return 'import';
}

/**
 * Where a freshly opened panel should land for this state.
 * @param {PanelSnapshot} s
 * @returns {Stage}
 */
function deriveStage(s) {
  if (s.captured) return 'capture';
  if (s.run) {
    if (s.run.status === 'halted' && s.run.submittedByHuman) return 'capture';
    return 'autofill';
  }
  if (s.prepared && s.verifyRows && s.engagement) return 'verify';
  return 'import';
}

/**
 * @param {Stage} a
 * @param {Stage} b
 * @returns {number}
 */
function cmp(a, b) {
  return STAGES.indexOf(a) - STAGES.indexOf(b);
}

/** Keep the UI stage within what the state allows. */
function clampStage() {
  if (!snap) return;
  const max = maxStage(snap);
  if (cmp(ui.stage, max) > 0) ui.stage = max;
  // A run that exists always pulls the panel to at least Autofill, so the
  // lead sees the step list rather than a stale earlier panel.
  if (snap.run && cmp(ui.stage, 'autofill') < 0) ui.stage = 'autofill';
  if (!snap.engagement && !snap.run && !snap.captured) ui.stage = 'import';
}

/**
 * @param {Stage} stage
 */
function goto(stage) {
  if (!snap) return;
  const max = maxStage(snap);
  ui.stage = cmp(stage, max) > 0 ? max : stage;
  ui.error = null;
  render();
}

/* ------------------------------------------------------------------------ */
/* Rendering                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * @param {AssistError | string | null} err
 */
function setError(err) {
  ui.error = err === null ? null : (typeof err === 'string' ? { class: 'internal', message: err } : err);
  renderError();
}

/**
 * @param {boolean} busy
 */
function setBusy(busy) {
  ui.busy = busy;
  renderFooter();
}

function renderError() {
  const e = ui.error;
  if (!e) {
    els.error.hidden = true;
    replace(els.error);
    return;
  }
  els.error.hidden = false;
  /** @type {HTMLElement[]} */
  const parts = [h('span', { class: 'error__class' }, e.class), h('div', null, e.message)];
  if (e.missing && e.missing.length) {
    parts.push(h('ul', null, e.missing.slice(0, 12).map((m) => h('li', null, m)), e.missing.length > 12 ? h('li', null, `… and ${e.missing.length - 12} more`) : null));
  }
  replace(els.error, parts);
}

function renderHeader() {
  if (!snap) return;
  els.version.textContent = `v${snap.version}`;
  const origin = snap.suiteOrigin || 'development fixture';
  els.origin.textContent = origin;
  els.origin.title = snap.suiteOrigin ? `Connected VCFO Suite origin: ${snap.suiteOrigin}` : 'No Suite origin set — using fixtures/engagement.json';
}

function renderRail() {
  if (!snap) return;
  const run = snap.run;
  const nodes = STAGES.map((stage, i) => {
    const s = /** @type {Stage} */ (stage);
    const rel = cmp(s, ui.stage);
    let cls = 'rail__node';
    /** @type {Node | string} */
    let inner = String(i + 1);
    if (rel < 0 || (s === 'capture' && snap && snap.captured && snap.captured.posted)) {
      cls += ' rail__node--done';
      inner = icon('check');
    } else if (rel === 0) {
      if (s === 'gate' || (run && run.status === 'paused')) {
        cls += ' rail__node--waiting';
        inner = icon('clock');
      } else if (run && (run.status === 'failed' || run.status === 'aborted') && s === 'autofill') {
        cls += ' rail__node--failed';
        inner = icon('x');
      } else {
        cls += ' rail__node--active';
      }
    }
    return h('div', { class: cls, title: STAGE_LABELS[s], 'aria-current': rel === 0 ? 'step' : undefined }, inner);
  });
  replace(els.rail, nodes);
}

/**
 * @returns {ViewContext}
 */
function viewContext() {
  return {
    snap: /** @type {PanelSnapshot} */ (snap),
    ui,
    request,
    refresh,
    setError,
    goto,
    setBusy,
    activeTabId,
    rerender: render,
  };
}

function renderFooter() {
  if (!snap) return;
  const view = VIEWS[ui.stage];
  const action = view.primary(viewContext());
  if (!action) {
    els.primary.hidden = true;
  } else {
    els.primary.hidden = false;
    els.primary.textContent = action.label;
    els.primary.disabled = action.disabled || ui.busy;
    els.primary.onclick = async () => {
      if (ui.busy) return;
      setError(null);
      setBusy(true);
      try {
        await action.onClick();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    };
  }
  els.stop.disabled = ui.stopping;
  els.stop.textContent = ui.stopping ? 'Stopping…' : 'Stop';
}

function render() {
  if (!snap) return;
  renderHeader();
  renderRail();
  const view = VIEWS[ui.stage];
  const root = h('section', { class: 'panel', 'data-stage': ui.stage });
  view.render(root, viewContext());
  replace(els.view, root);
  renderError();
  renderFooter();
}

/* ------------------------------------------------------------------------ */
/* Stop                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Abort the run at the next step boundary, then forget the engagement and
 * return to Import. Waits for the runner to reach a terminal status so the
 * loop cannot re-persist a run the panel just cleared.
 */
async function stop() {
  if (ui.stopping) return;
  ui.stopping = true;
  setError(null);
  renderFooter();
  try {
    const run = snap ? snap.run : null;
    if (run && (run.status === 'running' || run.status === 'paused')) {
      const r = await request({ type: MSG.ABORT_RUN });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      await waitForTerminal();
    }
    const reset = await request({ type: MSG.RESET });
    if (!reset.ok) {
      setError(reset.error);
      return;
    }
    ui.stage = 'import';
    await refresh();
  } finally {
    ui.stopping = false;
    renderFooter();
  }
}

/**
 * Resolve once the persisted run is no longer running/paused (or after a
 * bounded wait — a stuck content op is bounded by the worker's timeouts).
 * @returns {Promise<void>}
 */
function waitForTerminal() {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = async () => {
      const got = await chrome.storage.session.get(SESSION_KEYS.RUN_STATE);
      const run = /** @type {RunState | undefined} */ (got[SESSION_KEYS.RUN_STATE]);
      if (!run || (run.status !== 'running' && run.status !== 'paused') || Date.now() - started > 45000) {
        resolve();
        return;
      }
      setTimeout(() => { void tick(); }, 300);
    };
    void tick();
  });
}

/* ------------------------------------------------------------------------ */
/* Boot                                                                      */
/* ------------------------------------------------------------------------ */

els.stop.addEventListener('click', () => { void stop(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session') {
    if (SESSION_KEYS.RUN_STATE in changes && snap) {
      const next = changes[SESSION_KEYS.RUN_STATE].newValue;
      snap.run = next && typeof next === 'object' ? /** @type {RunState} */ (next) : null;
      clampStage();
      render();
      return;
    }
    void refresh();
  } else if (area === 'local') {
    void refresh();
  }
});

void (async () => {
  const r = await request({ type: MSG.GET_STATE });
  if (!r.ok) {
    setError(r.error);
    return;
  }
  snap = /** @type {PanelSnapshot} */ (r.value);
  ui.stage = deriveStage(snap);
  render();
})();
