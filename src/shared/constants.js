// Storage keys, message types, timeouts and the danger set. Shared by the
// service worker and the side panel (both ES modules). Content scripts are
// classic scripts and cannot import this file; anything they need is passed to
// them inside the op message, so there is one source of truth for every rule.

/** Version string shown in the panel header. Kept in step with manifest.json. */
export const ASSIST_VERSION = '0.1.0';

/** Suite payload schema versions this build understands. */
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1]);

/**
 * Suite versions this build has been exercised against, inclusive, format
 * `YYYY.MM.N`. A payload outside the range is a warning in the panel, not a
 * refusal: version skew is a smell. Only `schemaVersion` is a hard gate.
 */
export const KNOWN_SUITE_RANGE = Object.freeze({ from: '2026.09.0', to: '2026.12.0' });

/** Development Suite origin pre-declared in host_permissions. */
export const DEV_SUITE_ORIGIN = 'http://localhost:3000';

/** Origin of the portal, used to decide whether a tab is eligible for a run. */
export const MCA_ORIGIN_PATTERN = /^https:\/\/www\.mca\.gov\.in\//;

/**
 * Forms the panel can offer. Only the first is enabled. The loader looks for
 * `recipes/<id>.json`; in development mode it falls back to
 * `recipes/<id>.example.json`.
 */
export const FORMS = Object.freeze([
  Object.freeze({ id: 'spice-part-a', label: 'SPICe+ Part A — name reservation', enabled: true }),
  Object.freeze({ id: 'spice-part-b', label: 'SPICe+ Part B', enabled: false }),
  Object.freeze({ id: 'agile-pro', label: 'AGILE-PRO', enabled: false }),
]);

/** chrome.storage.session keys. PII lives only here. */
export const SESSION_KEYS = Object.freeze({
  /** The validated SuitePayload for the selected engagement. */
  ENGAGEMENT: 'va.session.engagement',
  /** Which path produced the engagement: suite | bundle | fixture. */
  ENGAGEMENT_SOURCE: 'va.session.engagementSource',
  /** The current RunState. */
  RUN_STATE: 'va.session.runState',
  /** Rows shown in panel 2 for the prepared form. */
  VERIFY_ROWS: 'va.session.verifyRows',
  /** Prepared form id and loaded recipe/map versions. */
  PREPARED: 'va.session.prepared',
  /** Result captured from the page for the return leg. */
  CAPTURED_RESULT: 'va.session.capturedResult',
});

/** chrome.storage.local keys. Preferences only. Never engagement data. */
export const LOCAL_KEYS = Object.freeze({
  SUITE_ORIGIN: 'va.pref.suiteOrigin',
  LAST_FORM: 'va.pref.lastForm',
  DEV_MODE: 'va.pref.devMode',
  PANEL_STATE: 'va.pref.panelState',
});

/** Message types from the side panel to the service worker. */
export const MSG = Object.freeze({
  GET_STATE: 'va.getState',
  SET_SUITE_ORIGIN: 'va.setSuiteOrigin',
  SET_DEV_MODE: 'va.setDevMode',
  LIST_ENGAGEMENTS: 'va.listEngagements',
  LOAD_ENGAGEMENT: 'va.loadEngagement',
  PREPARE_FORM: 'va.prepareForm',
  START_RUN: 'va.startRun',
  CONTINUE_GATE: 'va.continueGate',
  RESOLVE_IN_FLIGHT: 'va.resolveInFlight',
  ABORT_RUN: 'va.abortRun',
  OVERRIDE_MISMATCHES: 'va.overrideMismatches',
  MARK_SUBMITTED: 'va.markSubmitted',
  CAPTURE_RESULT: 'va.captureResult',
  POST_RESULT: 'va.postResult',
  RESET: 'va.reset',
});

/** Message type from the worker to a content script. */
export const CONTENT_MSG = Object.freeze({ OP: 'va.op' });

/** Timeouts, all owned by the worker. */
export const TIMEOUTS = Object.freeze({
  /** A single content-script op that should return immediately. */
  OP_MS: 15000,
  /** One slice of a long wait. Keeps the worker's idle timer reset. */
  WAIT_SLICE_MS: 8000,
  /** Margin added to a slice when waiting on the content script's reply. */
  SLICE_MARGIN_MS: 4000,
  /** Default for waitFor / waitForGone / waitForUrl when the step omits one. */
  WAIT_DEFAULT_MS: 20000,
  /** Quiet period for a dependent field without a loadingSelector. */
  SETTLE_QUIET_MS: 400,
  /** Upper bound on a settle wait. */
  SETTLE_MAX_MS: 5000,
  /** How long to wait for a navigating tab to reach status complete. */
  TAB_SETTLE_MS: 30000,
  /** Suite API calls. */
  SUITE_FETCH_MS: 20000,
  /** Widget listbox appearance. */
  WIDGET_OPEN_MS: 5000,
});

/**
 * Danger set. A `click` whose target matches any of these is refused by the
 * guard regardless of what the recipe says. Matched against text, value, id,
 * name, aria-label and type. Source strings, not RegExp objects, so they can
 * be passed to the content script for a second check right before the click.
 */
export const DANGER = Object.freeze({
  /** Exact `type` attribute values that are always refused. */
  types: Object.freeze(['submit', 'image']),
  /** Case-insensitive pattern applied to every attribute in the descriptor. */
  pattern: 'submit|pay|payment|confirm|proceed to pay|file|final|sign|dsc|delete|remove',
  flags: 'i',
});

/**
 * Credential set. A field whose key, label, sourceField, selector, element
 * id, name, type, autocomplete, placeholder or aria-label matches is never
 * filled and is refused by the loader when it appears in a field map.
 */
export const CREDENTIAL = Object.freeze({
  pattern: 'captcha|otp|passw|passcode|mpin|(?:^|[^a-z])pin(?![\\s_-]*code)|secret|token|cvv',
  flags: 'i',
  /** Element types that are credential inputs whatever their name. */
  types: Object.freeze(['password']),
});

/** Recipe ops the runner understands. Keep in step with `engine/ops/`. */
export const OPS = Object.freeze([
  'click', 'fill', 'fillGroup', 'select', 'check',
  'waitFor', 'waitForGone', 'waitForUrl', 'assert', 'humanGate', 'halt',
]);

/** Run log cap. Session storage is not unbounded. */
export const LOG_CAP = 200;

/** Ops that must not be re-sent blindly after a worker restart mid-step. */
export const NON_IDEMPOTENT_OPS = Object.freeze(['click', 'fill', 'fillGroup', 'select', 'check']);

/** Precondition ops. */
export const PRECONDITION_OPS = Object.freeze(['assertUrlMatches', 'assertLoggedIn']);

/** Allowed transform names, applied left to right. */
export const TRANSFORMS = Object.freeze([
  'trim', 'upper', 'lower', 'digitsOnly', 'dateDDMMYYYY', 'dateYYYYMMDD',
]);

/** Allowed field `entry.mode` values. */
export const ENTRY_MODES = Object.freeze(['typed', 'widget', 'unknown']);

/** Allowed field `selectors.stability` values. */
export const STABILITIES = Object.freeze(['stable', 'likely', 'fragile']);

/** Allowed field map frameworks. */
export const FRAMEWORKS = Object.freeze(['jquery', 'angular', 'react', 'aem', 'unknown', 'none']);

/** Suite API paths, relative to the configured origin. */
export const SUITE_API = Object.freeze({
  /** @param {string} form */
  list: (form) => `/api/assist/engagements?form=${encodeURIComponent(form)}`,
  /** @param {string} id @param {string} form */
  exportPath: (id, form) => `/api/assist/engagements/${encodeURIComponent(id)}/export?form=${encodeURIComponent(form)}`,
  /** @param {string} id */
  resultPath: (id) => `/api/assist/engagements/${encodeURIComponent(id)}/result`,
});

/** Bundle (.vcfoa) format identifiers. */
export const BUNDLE = Object.freeze({
  format: 'vcfoa',
  versions: Object.freeze([1]),
  extension: '.vcfoa',
});

/** The panel's five stages, in order. */
export const STAGES = Object.freeze(['import', 'verify', 'autofill', 'gate', 'capture']);
