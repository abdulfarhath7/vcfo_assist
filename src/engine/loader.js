// Loads recipes, field maps and result recipes from the extension package,
// validates their shape, checks version compatibility, and refuses `.example`
// ids outside development mode. Nothing here knows an MCA selector.

import { Ok, Err } from '../shared/result.js';
import {
  OPS, PRECONDITION_OPS, TRANSFORMS, ENTRY_MODES, STABILITIES, FRAMEWORKS,
  SUPPORTED_SCHEMA_VERSIONS, CREDENTIAL, NAVIGATE_ORIGINS,
} from '../shared/constants.js';
import { mockOrigin, retargetRecipe, retargetFieldMap, retargetResultRecipe } from './devtarget.js';
import { expandForPayload } from './expand.js';
import { isRecord, Problems } from '../shared/check.js';
import { selectorStrings } from '../shared/selectors.js';

/** @typedef {import('../shared/schema.js').Recipe} Recipe */
/** @typedef {import('../shared/schema.js').Step} Step */
/** @typedef {import('../shared/schema.js').Precondition} Precondition */
/** @typedef {import('../shared/schema.js').FieldMap} FieldMap */
/** @typedef {import('../shared/schema.js').FieldDef} FieldDef */
/** @typedef {import('../shared/schema.js').Selectors} Selectors */
/** @typedef {import('../shared/schema.js').ResultRecipe} ResultRecipe */
/** @typedef {import('../shared/schema.js').ResultField} ResultField */

const EXAMPLE_SUFFIX = '.example';
const FIELD_TYPES = Object.freeze(['text', 'textarea', 'number', 'select', 'checkbox', 'radio', 'date', 'email', 'tel', 'file']);
const WIDGET_KINDS = Object.freeze(['listbox', 'combobox', 'datepicker', 'radio', 'checkbox', 'native', 'checklist']);
/** Ops a forEach row may contain. Fill-by-key ops are excluded: a row fills through its section. */
const FOREACH_INNER_OPS = Object.freeze(['click', 'fillGroup', 'waitFor', 'waitForGone', 'assert', 'humanGate']);
const READ_MODES = Object.freeze(['text', 'value', 'attribute']);

/* ------------------------------------------------------------------------ */
/* Fetching                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Fetch a JSON file bundled in the extension. A missing file is `null`, not
 * an error, so callers can decide whether a fallback is allowed.
 * @param {string} path  Package-relative, e.g. `recipes/spice-part-a.json`
 * @returns {Promise<import('../shared/result.js').Result<unknown | null>>}
 */
export async function fetchPackagedJson(path) {
  let response;
  try {
    response = await fetch(chrome.runtime.getURL(path));
  } catch {
    return Ok(null);
  }
  if (!response.ok) return Ok(null);
  try {
    return Ok(await response.json());
  } catch (e) {
    return Err('validation', `${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Resolve the real file for a form, or the `.example` stub in development
 * mode. Returns the parsed JSON and the path it came from.
 * @param {'recipes' | 'fieldmaps'} dir
 * @param {string} baseName   e.g. `spice-part-a` or `spice-part-a.result`
 * @param {boolean} devMode
 * @returns {Promise<import('../shared/result.js').Result<{ raw: unknown, path: string }>>}
 */
async function fetchWithExampleFallback(dir, baseName, devMode) {
  const realPath = `${dir}/${baseName}.json`;
  const real = await fetchPackagedJson(realPath);
  if (!real.ok) return real;
  if (real.value !== null) return Ok({ raw: real.value, path: realPath });

  const examplePath = `${dir}/${baseName}${EXAMPLE_SUFFIX}.json`;
  if (!devMode) {
    return Err('validation',
      `${realPath} is not present in this build. The example stub ${examplePath} is only loadable in development mode.`);
  }
  const example = await fetchPackagedJson(examplePath);
  if (!example.ok) return example;
  if (example.value === null) {
    return Err('validation', `Neither ${realPath} nor ${examplePath} exists in this build.`);
  }
  return Ok({ raw: example.value, path: examplePath });
}

/**
 * Enforce the `.example` rule on a loaded file's id.
 * @param {string} id
 * @param {string} path
 * @param {boolean} devMode
 * @returns {import('../shared/result.js').Result<true>}
 */
function refuseExampleOutsideDev(id, path, devMode) {
  if (id.endsWith(EXAMPLE_SUFFIX) && !devMode) {
    return Err('validation',
      `${path} has id "${id}", which is an example stub. Stubs are refused outside development mode.`);
  }
  return Ok(true);
}

/* ------------------------------------------------------------------------ */
/* Shape validation                                                          */
/* ------------------------------------------------------------------------ */

/**
 * @param {Problems} p
 * @param {unknown} raw
 * @param {string} path
 * @returns {Selectors | undefined}
 */
function readSelectors(p, raw, path) {
  if (!isRecord(raw)) {
    p.add(path, 'must be an object');
    return undefined;
  }
  if (raw.strategy !== undefined && raw.strategy !== 'css') {
    if (raw.strategy !== 'guideFieldNode') {
      p.add(`${path}.strategy`, 'must be "css" or "guideFieldNode"');
      return undefined;
    }
    return readGuideFieldNodeSelectors(p, raw, path);
  }
  const primary = p.string(raw, 'primary', `${path}.primary`);
  const fallbacks = p.stringArray(raw, 'fallbacks', `${path}.fallbacks`);
  const shadowPath = p.stringArray(raw, 'shadowPath', `${path}.shadowPath`);
  const stability = p.oneOf(raw, 'stability', STABILITIES, `${path}.stability`);
  if (primary === undefined || fallbacks === undefined || shadowPath === undefined || stability === undefined) {
    return undefined;
  }
  return {
    primary,
    fallbacks,
    shadowPath,
    stability: /** @type {import('../shared/schema.js').Stability} */ (stability),
  };
}

/**
 * `{ strategy: "guideFieldNode", key, instance?, stability? }` — the AEM
 * semantic-class addressing ported from the reference build. `instance`
 * addresses a repeat-panel row; `stability` defaults to stable because the
 * key is the class MCA itself names the field with.
 * @param {Problems} p
 * @param {Record<string, unknown>} raw
 * @param {string} path
 * @returns {Selectors | undefined}
 */
function readGuideFieldNodeSelectors(p, raw, path) {
  const key = p.string(raw, 'key', `${path}.key`);
  // Escaped with CSS.escape when resolved, so a leading digit (`2b-ni-pan-dsc`) is fine.
  if (key !== undefined && !/^[\w-]+$/.test(key)) {
    p.add(`${path}.key`, `"${key}" is not a CSS class name`);
  }
  /** @type {Selectors} */
  const out = { strategy: 'guideFieldNode', key: key ?? '', primary: '', fallbacks: [], shadowPath: [], stability: 'stable' };
  if (raw.instance !== undefined) {
    const instance = p.int(raw, 'instance', `${path}.instance`);
    if (instance !== undefined && instance < 0) p.add(`${path}.instance`, 'must be 0 or more');
    else if (instance !== undefined) out.instance = instance;
  }
  if (raw.stability !== undefined) {
    const stability = p.oneOf(raw, 'stability', STABILITIES, `${path}.stability`);
    if (stability !== undefined) out.stability = /** @type {import('../shared/schema.js').Stability} */ (stability);
  }
  for (const k of ['primary', 'fallbacks', 'shadowPath']) {
    if (raw[k] !== undefined) p.add(`${path}.${k}`, 'is not used by the guideFieldNode strategy; remove it');
  }
  return key === undefined ? undefined : out;
}

/**
 * @param {Problems} p
 * @param {unknown} raw
 * @param {string} path
 * @returns {Precondition | undefined}
 */
function readPrecondition(p, raw, path) {
  if (!isRecord(raw)) {
    p.add(path, 'must be an object');
    return undefined;
  }
  const op = p.oneOf(raw, 'op', PRECONDITION_OPS, `${path}.op`);
  const message = p.string(raw, 'message', `${path}.message`);
  if (op === undefined || message === undefined) return undefined;
  /** @type {Precondition} */
  const pre = { op: /** @type {Precondition['op']} */ (op), message };
  if (op === 'assertUrlMatches') {
    const pattern = p.regex(raw, 'pattern', `${path}.pattern`);
    if (pattern === undefined) return undefined;
    pre.pattern = pattern;
  } else {
    const selector = p.string(raw, 'selector', `${path}.selector`);
    if (selector === undefined) return undefined;
    pre.selector = selector;
  }
  return pre;
}

/**
 * @param {Problems} p
 * @param {unknown} raw
 * @param {string} path
 * @returns {Step | undefined}
 */
function readStep(p, raw, path, nested = false) {
  if (!isRecord(raw)) {
    p.add(path, 'must be an object');
    return undefined;
  }
  const opRaw = raw.op;
  if (typeof opRaw !== 'string' || !OPS.includes(opRaw)) {
    p.add(`${path}.op`, `must be one of ${OPS.join(', ')} (there is no submit op)`);
    return undefined;
  }
  const op = /** @type {import('../shared/schema.js').StepOp} */ (opRaw);
  if (nested && !FOREACH_INNER_OPS.includes(op)) {
    p.add(`${path}.op`, `"${op}" is not allowed inside forEach (allowed: ${FOREACH_INNER_OPS.join(', ')})`);
    return undefined;
  }
  /** @type {Step} */
  const step = { op };
  if (typeof raw.label === 'string') step.label = raw.label;
  if (raw.timeoutMs !== undefined) {
    const t = p.int(raw, 'timeoutMs', `${path}.timeoutMs`);
    if (t !== undefined) step.timeoutMs = t;
  }
  switch (op) {
    case 'click':
    case 'waitFor':
    case 'waitForGone':
    case 'assert': {
      const selector = p.string(raw, 'selector', `${path}.selector`);
      if (selector !== undefined) step.selector = selector;
      if (op === 'click' && raw.optional !== undefined) {
        const optional = p.bool(raw, 'optional', `${path}.optional`);
        if (optional) step.optional = true;
      }
      if (op === 'waitFor' && raw.settleMs !== undefined) {
        const settleMs = p.int(raw, 'settleMs', `${path}.settleMs`);
        if (settleMs !== undefined) step.settleMs = settleMs;
      }
      if (op === 'assert') {
        const message = p.string(raw, 'message', `${path}.message`);
        if (message !== undefined) step.message = message;
      }
      break;
    }
    case 'fill':
    case 'select': {
      const key = p.string(raw, 'key', `${path}.key`);
      if (key !== undefined) step.key = key;
      break;
    }
    case 'check': {
      const key = p.string(raw, 'key', `${path}.key`);
      if (key !== undefined) step.key = key;
      if (typeof raw.value === 'boolean' || typeof raw.value === 'string') {
        step.value = raw.value;
      } else if (raw.value !== undefined) {
        p.add(`${path}.value`, 'must be a boolean or string when present');
      }
      break;
    }
    case 'fillGroup': {
      const section = p.string(raw, 'section', `${path}.section`);
      if (section !== undefined) step.section = section;
      break;
    }
    case 'waitForUrl': {
      const pattern = p.regex(raw, 'pattern', `${path}.pattern`);
      if (pattern !== undefined) step.pattern = pattern;
      break;
    }
    case 'humanGate': {
      const message = p.string(raw, 'message', `${path}.message`);
      if (message !== undefined) step.message = message;
      break;
    }
    case 'halt': {
      const reason = p.string(raw, 'reason', `${path}.reason`);
      if (reason !== undefined) step.reason = reason;
      break;
    }
    case 'navigate': {
      const url = p.string(raw, 'url', `${path}.url`);
      if (url === undefined) break;
      let origin = '';
      try {
        origin = new URL(url).origin;
      } catch {
        origin = '';
      }
      if (!NAVIGATE_ORIGINS.includes(origin)) p.add(`${path}.url`, `must be on ${NAVIGATE_ORIGINS.join(', ')}; "${url}" is not`);
      else step.url = url;
      break;
    }
    case 'forEach': {
      const over = p.string(raw, 'over', `${path}.over`);
      if (over !== undefined) {
        if (!/^[A-Za-z][\w.]*$/.test(over)) p.add(`${path}.over`, `"${over}" is not a field prefix`);
        step.over = over;
      }
      if (raw.max !== undefined) {
        const max = p.int(raw, 'max', `${path}.max`);
        if (max !== undefined && max < 1) p.add(`${path}.max`, 'must be 1 or more');
        else if (max !== undefined) step.max = max;
      }
      const inner = p.array(raw, 'steps', `${path}.steps`);
      if (inner) {
        if (inner.length === 0) p.add(`${path}.steps`, 'must contain at least one step');
        /** @type {Step[]} */
        const list = [];
        inner.forEach((item, i) => {
          const s = readStep(p, item, `${path}.steps[${i}]`, true);
          if (s) list.push(s);
        });
        step.steps = list;
      }
      break;
    }
  }
  return step;
}

/**
 * Validate a raw recipe object.
 * @param {unknown} raw
 * @param {string} [path]
 * @returns {import('../shared/result.js').Result<Recipe>}
 */
export function validateRecipeShape(raw, path = 'recipe') {
  const p = new Problems(path);
  if (!isRecord(raw)) return Err('validation', `${path} must be a JSON object`);
  const id = p.string(raw, 'id');
  const version = p.int(raw, 'version');
  const label = p.string(raw, 'label');
  const origin = p.string(raw, 'origin');
  /** @type {string | string[] | undefined} */
  let requiresFieldMap;
  if (Array.isArray(raw.requiresFieldMap)) {
    requiresFieldMap = p.stringArray(raw, 'requiresFieldMap');
    if (requiresFieldMap && requiresFieldMap.length === 0) p.add('requiresFieldMap', 'must name at least one field map');
  } else {
    requiresFieldMap = p.string(raw, 'requiresFieldMap');
  }
  /** @type {'mock-only' | 'approved' | undefined} */
  let legalStatus;
  if (raw.legalStatus !== undefined) {
    const ls = p.oneOf(raw, 'legalStatus', ['mock-only', 'approved']);
    if (ls !== undefined) legalStatus = /** @type {'mock-only' | 'approved'} */ (ls);
  }
  const requiresSchemaVersion = p.int(raw, 'requiresSchemaVersion');
  let requiresFieldMapVersion = 1;
  if (raw.requiresFieldMapVersion !== undefined) {
    const v = p.int(raw, 'requiresFieldMapVersion');
    if (v !== undefined) requiresFieldMapVersion = v;
  }
  /** @type {Precondition[]} */
  const preconditions = [];
  const preRaw = p.array(raw, 'preconditions');
  if (preRaw) {
    preRaw.forEach((item, i) => {
      const pre = readPrecondition(p, item, `preconditions[${i}]`);
      if (pre) preconditions.push(pre);
    });
  }
  /** @type {Step[]} */
  const steps = [];
  const stepsRaw = p.array(raw, 'steps');
  if (stepsRaw) {
    stepsRaw.forEach((item, i) => {
      const step = readStep(p, item, `steps[${i}]`);
      if (step) steps.push(step);
    });
    if (stepsRaw.length === 0) p.add('steps', 'must contain at least one step');
    const last = steps[steps.length - 1];
    if (last && last.op !== 'halt') p.add('steps', 'must end with a halt step');
    steps.forEach((s, i) => {
      if (s.op === 'halt' && i !== steps.length - 1) p.add(`steps[${i}]`, 'halt must be the last step');
    });
  }
  if (p.any) return Err('validation', `${path} failed validation: ${p.list.join('; ')}`, { missing: p.list });
  if (id === undefined || version === undefined || label === undefined || origin === undefined
    || requiresFieldMap === undefined || requiresSchemaVersion === undefined) {
    return Err('validation', `${path} failed validation`);
  }
  /** @type {Recipe} */
  const recipe = {
    id, version, label, origin, requiresFieldMap, requiresFieldMapVersion,
    requiresSchemaVersion, preconditions, steps,
  };
  if (legalStatus) recipe.legalStatus = legalStatus;
  if (typeof raw._note === 'string') recipe._note = raw._note;
  return Ok(recipe);
}

/**
 * True when any of the strings matches the credential set. Used to refuse a
 * field map that names a credential field.
 * @param {string[]} candidates
 * @returns {boolean}
 */
export function looksLikeCredential(candidates) {
  const re = new RegExp(CREDENTIAL.pattern, CREDENTIAL.flags);
  return candidates.some((c) => re.test(c));
}

/**
 * @param {Problems} p
 * @param {unknown} raw
 * @param {string} path
 * @returns {FieldDef | undefined}
 */
function readFieldDef(p, raw, path) {
  if (!isRecord(raw)) {
    p.add(path, 'must be an object');
    return undefined;
  }
  const key = p.string(raw, 'key', `${path}.key`);
  const label = p.string(raw, 'label', `${path}.label`);
  // null: a captured field no profile value is bound to yet. Never filled.
  /** @type {string | null | undefined} */
  const sourceField = raw.sourceField === null ? null : p.string(raw, 'sourceField', `${path}.sourceField`);
  const optional = p.bool(raw, 'optional', `${path}.optional`);
  const type = p.oneOf(raw, 'type', FIELD_TYPES, `${path}.type`);
  let maxLength = null;
  if (raw.maxLength !== null && raw.maxLength !== undefined) {
    const m = p.int(raw, 'maxLength', `${path}.maxLength`);
    if (m !== undefined) maxLength = m;
  }
  let transform = '';
  if (raw.transform !== undefined && raw.transform !== null) {
    if (typeof raw.transform !== 'string') {
      p.add(`${path}.transform`, 'must be a pipe-separated string');
    } else {
      transform = raw.transform;
      transform.split('|').map((t) => t.trim()).filter(Boolean).forEach((t) => {
        if (!TRANSFORMS.includes(t)) p.add(`${path}.transform`, `contains unknown transform "${t}"`);
      });
    }
  }
  /** @type {import('../shared/schema.js').FieldEntry | undefined} */
  let entry;
  const entryRaw = p.record(raw, 'entry', `${path}.entry`);
  if (entryRaw) {
    const mode = p.oneOf(entryRaw, 'mode', ENTRY_MODES, `${path}.entry.mode`);
    if (mode !== undefined) {
      entry = { mode: /** @type {import('../shared/schema.js').EntryMode} */ (mode), widgetKind: null };
      if (entryRaw.widgetKind !== undefined && entryRaw.widgetKind !== null) {
        const kind = p.oneOf(entryRaw, 'widgetKind', WIDGET_KINDS, `${path}.entry.widgetKind`);
        if (kind !== undefined) entry.widgetKind = /** @type {import('../shared/schema.js').WidgetKind} */ (kind);
      }
      if (mode === 'widget' && (entry.widgetKind === null || entry.widgetKind === undefined)) {
        p.add(`${path}.entry.widgetKind`, 'is required when entry.mode is "widget"');
      }
      if (typeof entryRaw.listboxSelector === 'string') entry.listboxSelector = entryRaw.listboxSelector;
      if (typeof entryRaw.optionSelector === 'string') entry.optionSelector = entryRaw.optionSelector;
      if (entryRaw.matchPrefix === true) entry.matchPrefix = true;
    }
  }
  const selectors = readSelectors(p, raw.selectors, `${path}.selectors`);
  const dependsOn = p.stringArray(raw, 'dependsOn', `${path}.dependsOn`);
  let loadingSelector = null;
  if (raw.loadingSelector !== null && raw.loadingSelector !== undefined) {
    const ls = p.string(raw, 'loadingSelector', `${path}.loadingSelector`);
    if (ls !== undefined) loadingSelector = ls;
  }
  /** @type {boolean | undefined} */
  let waitForOptions;
  if (raw.waitForOptions !== undefined) waitForOptions = p.bool(raw, 'waitForOptions', `${path}.waitForOptions`);
  /** @type {string | undefined} */
  let note;
  if (raw.note !== undefined && raw.note !== null) note = p.string(raw, 'note', `${path}.note`);
  /** @type {string | undefined} */
  let verifyIn;
  if (raw.verifyIn !== undefined && raw.verifyIn !== null) verifyIn = p.string(raw, 'verifyIn', `${path}.verifyIn`);
  /** @type {number | undefined} */
  let maxSizeKB;
  if (raw.maxSizeKB !== undefined && raw.maxSizeKB !== null) maxSizeKB = p.int(raw, 'maxSizeKB', `${path}.maxSizeKB`);
  /** @type {string[] | undefined} */
  let accept;
  if (raw.accept !== undefined) accept = p.stringArray(raw, 'accept', `${path}.accept`);
  if (sourceField === null && optional === false) p.add(`${path}.optional`, 'must be true when sourceField is null');
  if (key === undefined || label === undefined || sourceField === undefined || optional === undefined
    || type === undefined || entry === undefined || selectors === undefined || dependsOn === undefined) {
    return undefined;
  }
  const credentialCandidates = [key, label, sourceField ?? '', ...selectorStrings(selectors)];
  if (looksLikeCredential(credentialCandidates)) {
    p.add(path, `names a credential-like field ("${key}"); credentials are never filled`);
    return undefined;
  }
  /** @type {FieldDef} */
  const def = {
    key, label, sourceField, optional,
    type: /** @type {import('../shared/schema.js').FieldType} */ (type),
    maxLength, transform, entry, selectors, dependsOn, loadingSelector,
  };
  if (waitForOptions) def.waitForOptions = true;
  if (note) def.note = note;
  if (verifyIn) def.verifyIn = verifyIn;
  if (maxSizeKB !== undefined) def.maxSizeKB = maxSizeKB;
  if (accept) def.accept = accept;
  return def;
}

/**
 * Validate a raw field map object, including dependency references.
 * @param {unknown} raw
 * @param {string} [path]
 * @returns {import('../shared/result.js').Result<FieldMap>}
 */
export function validateFieldMapShape(raw, path = 'fieldmap') {
  const p = new Problems(path);
  if (!isRecord(raw)) return Err('validation', `${path} must be a JSON object`);
  const id = p.string(raw, 'id');
  const version = p.int(raw, 'version');
  const origin = p.string(raw, 'origin');
  const framework = p.oneOf(raw, 'framework', FRAMEWORKS);
  const requiresSchemaVersion = p.int(raw, 'requiresSchemaVersion');
  const capturedFrom = p.string(raw, 'capturedFrom');
  /** @type {Record<string, FieldDef[]>} */
  const sections = {};
  const sectionsRaw = p.record(raw, 'sections');
  if (sectionsRaw) {
    const names = Object.keys(sectionsRaw);
    if (names.length === 0) p.add('sections', 'must contain at least one section');
    /** @type {Set<string>} */
    const allKeys = new Set();
    for (const name of names) {
      const list = sectionsRaw[name];
      if (!Array.isArray(list)) {
        p.add(`sections.${name}`, 'must be an array of fields');
        continue;
      }
      /** @type {FieldDef[]} */
      const fields = [];
      list.forEach((item, i) => {
        const f = readFieldDef(p, item, `sections.${name}[${i}]`);
        if (f) {
          if (allKeys.has(f.key)) p.add(`sections.${name}[${i}].key`, `duplicates key "${f.key}"`);
          allKeys.add(f.key);
          fields.push(f);
        }
      });
      sections[name] = fields;
    }
    for (const [name, fields] of Object.entries(sections)) {
      const keys = new Set(fields.map((f) => f.key));
      for (const f of fields) {
        for (const dep of f.dependsOn) {
          if (!keys.has(dep)) p.add(`sections.${name}`, `field "${f.key}" dependsOn "${dep}" which is not in the same section`);
        }
      }
      const cycle = findCycle(fields);
      if (cycle) p.add(`sections.${name}`, `dependsOn cycle: ${cycle.join(' -> ')}`);
    }
  }
  if (p.any) return Err('validation', `${path} failed validation: ${p.list.join('; ')}`, { missing: p.list });
  if (id === undefined || version === undefined || origin === undefined || framework === undefined
    || requiresSchemaVersion === undefined || capturedFrom === undefined) {
    return Err('validation', `${path} failed validation`);
  }
  /** @type {FieldMap} */
  const map = {
    id, version, origin,
    framework: /** @type {import('../shared/schema.js').Framework} */ (framework),
    requiresSchemaVersion, capturedFrom, sections,
  };
  if (typeof raw._note === 'string') map._note = raw._note;
  return Ok(map);
}

/**
 * Detect a dependsOn cycle inside one section.
 * @param {FieldDef[]} fields
 * @returns {string[] | null}
 */
function findCycle(fields) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  /** @type {Set<string>} */
  const done = new Set();
  /** @type {string[]} */
  const stack = [];
  /**
   * @param {string} key
   * @returns {string[] | null}
   */
  const visit = (key) => {
    if (done.has(key)) return null;
    const at = stack.indexOf(key);
    if (at >= 0) return [...stack.slice(at), key];
    stack.push(key);
    const f = byKey.get(key);
    if (f) {
      for (const dep of f.dependsOn) {
        const c = visit(dep);
        if (c) return c;
      }
    }
    stack.pop();
    done.add(key);
    return null;
  };
  for (const f of fields) {
    const c = visit(f.key);
    if (c) return c;
  }
  return null;
}

/**
 * Validate a raw result recipe.
 * @param {unknown} raw
 * @param {string} [path]
 * @returns {import('../shared/result.js').Result<ResultRecipe>}
 */
export function validateResultRecipeShape(raw, path = 'resultRecipe') {
  const p = new Problems(path);
  if (!isRecord(raw)) return Err('validation', `${path} must be a JSON object`);
  const id = p.string(raw, 'id');
  const version = p.int(raw, 'version');
  const form = p.string(raw, 'form');
  const label = p.string(raw, 'label');
  const origin = p.string(raw, 'origin');
  /** @type {Precondition[]} */
  const preconditions = [];
  if (raw.preconditions !== undefined) {
    const preRaw = p.array(raw, 'preconditions');
    if (preRaw) {
      preRaw.forEach((item, i) => {
        const pre = readPrecondition(p, item, `preconditions[${i}]`);
        if (pre) preconditions.push(pre);
      });
    }
  }
  /** @type {ResultField[]} */
  const extract = [];
  const extractRaw = p.array(raw, 'extract');
  if (extractRaw) {
    extractRaw.forEach((item, i) => {
      const fp = `extract[${i}]`;
      if (!isRecord(item)) {
        p.add(fp, 'must be an object');
        return;
      }
      const key = p.string(item, 'key', `${fp}.key`);
      const flabel = p.string(item, 'label', `${fp}.label`);
      const read = p.oneOf(item, 'read', READ_MODES, `${fp}.read`);
      const optional = p.bool(item, 'optional', `${fp}.optional`);
      const selectors = readSelectors(p, item.selectors, `${fp}.selectors`);
      let attribute;
      if (read === 'attribute') attribute = p.string(item, 'attribute', `${fp}.attribute`);
      let pattern;
      if (item.pattern !== undefined) pattern = p.regex(item, 'pattern', `${fp}.pattern`);
      if (key === undefined || flabel === undefined || read === undefined || optional === undefined || selectors === undefined) return;
      /** @type {ResultField} */
      const rf = { key, label: flabel, selectors, read: /** @type {ResultField['read']} */ (read), optional };
      if (attribute !== undefined) rf.attribute = attribute;
      if (pattern !== undefined) rf.pattern = pattern;
      extract.push(rf);
    });
    if (!extract.some((f) => f.key === 'srn')) p.add('extract', 'must define an "srn" field');
  }
  if (p.any) return Err('validation', `${path} failed validation: ${p.list.join('; ')}`, { missing: p.list });
  if (id === undefined || version === undefined || form === undefined || label === undefined || origin === undefined) {
    return Err('validation', `${path} failed validation`);
  }
  /** @type {ResultRecipe} */
  const rr = { id, version, form, label, origin, preconditions, extract };
  if (isRecord(raw.report)) {
    const r = raw.report;
    /** @type {NonNullable<ResultRecipe['report']>} */
    const report = {};
    if (typeof r.form === 'string') report.form = r.form;
    if (r.subjectKind === 'filing' || r.subjectKind === 'registration') report.subjectKind = r.subjectKind;
    if (typeof r.subjectKey === 'string') report.subjectKey = r.subjectKey;
    if (typeof r.referenceKey === 'string') {
      if (!/^[a-z][A-Za-z]{1,30}$/.test(r.referenceKey)) p.add('report.referenceKey', 'must be a plain key such as "arn"');
      else report.referenceKey = r.referenceKey;
    }
    rr.report = report;
  }
  if (typeof raw._note === 'string') rr._note = raw._note;
  return Ok(rr);
}

/* ------------------------------------------------------------------------ */
/* Compatibility                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Check that a recipe and a field map belong together and that this build
 * understands the schema version they require. Also checks every step
 * reference (keys, sections) against the map.
 * @param {Recipe} recipe
 * @param {FieldMap} fieldMap
 * @returns {import('../shared/result.js').Result<true>}
 */
export function checkCompatibility(recipe, fieldMap) {
  /** @type {string[]} */
  const problems = [];
  if (mapIdOf(recipe) !== fieldMap.id) {
    problems.push(`recipe "${recipe.id}" requires field map "${mapIdOf(recipe)}" but "${fieldMap.id}" was loaded`);
  }
  const needVersion = recipe.requiresFieldMapVersion ?? 1;
  if (fieldMap.version < needVersion) {
    problems.push(`field map version ${fieldMap.version} is behind the recipe's required version ${needVersion}`);
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(recipe.requiresSchemaVersion)) {
    problems.push(`recipe requires schemaVersion ${recipe.requiresSchemaVersion}; this build supports ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(fieldMap.requiresSchemaVersion)) {
    problems.push(`field map requires schemaVersion ${fieldMap.requiresSchemaVersion}; this build supports ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`);
  }
  if (recipe.requiresSchemaVersion !== fieldMap.requiresSchemaVersion) {
    problems.push(`recipe requires schemaVersion ${recipe.requiresSchemaVersion} but the field map requires ${fieldMap.requiresSchemaVersion}`);
  }
  if (recipe.origin !== fieldMap.origin) {
    problems.push(`recipe origin ${recipe.origin} differs from field map origin ${fieldMap.origin}`);
  }
  const allKeys = new Set(Object.values(fieldMap.sections).flat().map((f) => f.key));
  const flat = recipe.steps.flatMap((s, i) => (s.op === 'forEach' ? (s.steps ?? []).map((x) => /** @type {[import('../shared/schema.js').Step, string]} */ ([x, `steps[${i}].steps`])) : [/** @type {[import('../shared/schema.js').Step, string]} */ ([s, `steps[${i}]`])]));
  flat.forEach(([s, where]) => {
    if (s.op === 'fillGroup' && s.section !== undefined && !(s.section in fieldMap.sections)) {
      problems.push(`${where} fillGroup references section "${s.section}" which the field map lacks`);
    }
    if ((s.op === 'fill' || s.op === 'select' || s.op === 'check') && s.key !== undefined && !allKeys.has(s.key)) {
      problems.push(`${where} ${s.op} references key "${s.key}" which the field map lacks`);
    }
  });
  if (problems.length) {
    return Err('version', `Recipe and field map are not compatible: ${problems.join('; ')}`, { missing: problems });
  }
  return Ok(true);
}

/* ------------------------------------------------------------------------ */
/* Public loaders                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Load and validate a recipe for a form.
 * @param {string} formId
 * @param {boolean} devMode
 * @returns {Promise<import('../shared/result.js').Result<{ recipe: Recipe, path: string }>>}
 */
export async function loadRecipe(formId, devMode) {
  const fetched = await fetchWithExampleFallback('recipes', formId, devMode);
  if (!fetched.ok) return fetched;
  const shaped = validateRecipeShape(fetched.value.raw, fetched.value.path);
  if (!shaped.ok) return shaped;
  const allowed = refuseExampleOutsideDev(shaped.value.id, fetched.value.path, devMode);
  if (!allowed.ok) return allowed;
  return Ok({ recipe: retargetRecipe(shaped.value, await mockOrigin(devMode)), path: fetched.value.path });
}

/**
 * The field map id a recipe runs on: its one map, or the joined ids of several.
 * @param {Recipe} recipe
 * @returns {string}
 */
export function mapIdOf(recipe) {
  return Array.isArray(recipe.requiresFieldMap) ? recipe.requiresFieldMap.join('+') : recipe.requiresFieldMap;
}

/**
 * Load several field maps (one per portal tab) and merge them into one. They
 * must share origin, framework and schema version; section names and keys must
 * not repeat. The merged version is the lowest of the parts.
 * @param {string[]} ids
 * @param {boolean} devMode
 * @returns {Promise<import('../shared/result.js').Result<{ fieldMap: FieldMap, path: string }>>}
 */
async function loadMergedFieldMaps(ids, devMode) {
  /** @type {FieldMap[]} */
  const parts = [];
  /** @type {string[]} */
  const paths = [];
  for (const id of ids) {
    const m = await loadFieldMap(id, devMode);
    if (!m.ok) return m;
    parts.push(m.value.fieldMap);
    paths.push(m.value.path);
  }
  const first = parts[0];
  /** @type {Record<string, FieldDef[]>} */
  const sections = {};
  /** @type {Set<string>} */
  const keys = new Set();
  for (const part of parts) {
    if (part.origin !== first.origin || part.framework !== first.framework || part.requiresSchemaVersion !== first.requiresSchemaVersion) {
      return Err('validation', `Field map "${part.id}" differs from "${first.id}" in origin, framework or schema version; they cannot be merged.`);
    }
    for (const [name, fields] of Object.entries(part.sections)) {
      if (name in sections) return Err('validation', `Section "${name}" appears in more than one of the field maps ${ids.join(', ')}.`);
      for (const f of fields) {
        if (keys.has(f.key)) return Err('validation', `Field key "${f.key}" appears in more than one of the field maps ${ids.join(', ')}.`);
        keys.add(f.key);
      }
      sections[name] = fields;
    }
  }
  return Ok({
    fieldMap: {
      id: ids.join('+'),
      version: Math.min(...parts.map((m) => m.version)),
      origin: first.origin,
      framework: first.framework,
      requiresSchemaVersion: first.requiresSchemaVersion,
      capturedFrom: parts.map((m) => `${m.id}: ${m.capturedFrom}`).join(' | '),
      sections,
    },
    path: paths.join(', '),
  });
}

/**
 * Load and validate the field map a recipe requires. The map id may carry
 * the `.example` suffix; the file is looked up by the id minus that suffix so
 * the same fallback rule applies.
 * @param {string} mapId
 * @param {boolean} devMode
 * @returns {Promise<import('../shared/result.js').Result<{ fieldMap: FieldMap, path: string }>>}
 */
export async function loadFieldMap(mapId, devMode) {
  const base = mapId.endsWith(EXAMPLE_SUFFIX) ? mapId.slice(0, -EXAMPLE_SUFFIX.length) : mapId;
  const fetched = await fetchWithExampleFallback('fieldmaps', base, devMode);
  if (!fetched.ok) return fetched;
  const shaped = validateFieldMapShape(fetched.value.raw, fetched.value.path);
  if (!shaped.ok) return shaped;
  const allowed = refuseExampleOutsideDev(shaped.value.id, fetched.value.path, devMode);
  if (!allowed.ok) return allowed;
  return Ok({ fieldMap: retargetFieldMap(shaped.value, await mockOrigin(devMode)), path: fetched.value.path });
}

/**
 * Load and validate the result recipe for a form (`recipes/<form>.result.json`).
 * @param {string} formId
 * @param {boolean} devMode
 * @returns {Promise<import('../shared/result.js').Result<{ resultRecipe: ResultRecipe, path: string }>>}
 */
export async function loadResultRecipe(formId, devMode) {
  const fetched = await fetchWithExampleFallback('recipes', `${formId}.result`, devMode);
  if (!fetched.ok) return fetched;
  const shaped = validateResultRecipeShape(fetched.value.raw, fetched.value.path);
  if (!shaped.ok) return shaped;
  const allowed = refuseExampleOutsideDev(shaped.value.id, fetched.value.path, devMode);
  if (!allowed.ok) return allowed;
  if (shaped.value.form !== formId) {
    return Err('validation', `${fetched.value.path} is for form "${shaped.value.form}", not "${formId}"`);
  }
  return Ok({ resultRecipe: retargetResultRecipe(shaped.value, await mockOrigin(devMode)), path: fetched.value.path });
}

/**
 * Load recipe and field map for a form, validated and compatibility-checked.
 * @param {string} formId
 * @param {boolean} devMode
 * @returns {Promise<import('../shared/result.js').Result<{ recipe: Recipe, fieldMap: FieldMap, recipePath: string, fieldMapPath: string }>>}
 */
export async function loadForm(formId, devMode) {
  const r = await loadRecipe(formId, devMode);
  if (!r.ok) return r;
  const need = r.value.recipe.requiresFieldMap;
  const m = Array.isArray(need) ? await loadMergedFieldMaps(need, devMode) : await loadFieldMap(need, devMode);
  if (!m.ok) return m;
  const compat = checkCompatibility(r.value.recipe, m.value.fieldMap);
  if (!compat.ok) return compat;
  return Ok({
    recipe: r.value.recipe,
    fieldMap: m.value.fieldMap,
    recipePath: r.value.path,
    fieldMapPath: m.value.path,
  });
}

/**
 * Load a form and expand its repeat groups (forEach) for one payload. Every
 * caller that runs or prepares a form uses this, so the steps the panel lists,
 * the steps the runner executes and the steps a restarted worker rebuilds are
 * the same.
 * @param {string} formId
 * @param {boolean} devMode
 * @param {import('../shared/schema.js').SuitePayload} payload
 * @returns {Promise<import('../shared/result.js').Result<{ recipe: Recipe, fieldMap: FieldMap, recipePath: string, fieldMapPath: string }>>}
 */
export async function loadFormFor(formId, devMode, payload) {
  const loaded = await loadForm(formId, devMode);
  if (!loaded.ok) return loaded;
  const expanded = expandForPayload(loaded.value.recipe, loaded.value.fieldMap, payload);
  return Ok({ ...loaded.value, recipe: expanded.recipe, fieldMap: expanded.fieldMap });
}

/**
 * Field definitions of a map in fill order for one section: a stable
 * topological order that respects `dependsOn` while keeping map order where
 * nothing forces otherwise.
 * @param {FieldMap} fieldMap
 * @param {string} section
 * @returns {FieldDef[]}
 */
export function orderedFields(fieldMap, section) {
  const fields = fieldMap.sections[section] ?? [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  /** @type {FieldDef[]} */
  const out = [];
  /** @type {Set<string>} */
  const placed = new Set();
  /** @param {FieldDef} f */
  const place = (f) => {
    if (placed.has(f.key)) return;
    placed.add(f.key);
    for (const dep of f.dependsOn) {
      const d = byKey.get(dep);
      if (d) place(d);
    }
    out.push(f);
  };
  fields.forEach(place);
  return out;
}

/**
 * Find a field by key across all sections.
 * @param {FieldMap} fieldMap
 * @param {string} key
 * @returns {{ field: FieldDef, section: string } | null}
 */
export function findField(fieldMap, key) {
  for (const [section, fields] of Object.entries(fieldMap.sections)) {
    const field = fields.find((f) => f.key === key);
    if (field) return { field, section };
  }
  return null;
}
