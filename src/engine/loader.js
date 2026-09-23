// Loads recipes, field maps and result recipes from the extension package,
// validates their shape, checks version compatibility, and refuses `.example`
// ids outside development mode. Nothing here knows an MCA selector.

import { Ok, Err } from '../shared/result.js';
import {
  OPS, PRECONDITION_OPS, TRANSFORMS, ENTRY_MODES, STABILITIES, FRAMEWORKS,
  SUPPORTED_SCHEMA_VERSIONS, CREDENTIAL,
} from '../shared/constants.js';
import { isRecord, Problems } from '../shared/check.js';

/** @typedef {import('../shared/schema.js').Recipe} Recipe */
/** @typedef {import('../shared/schema.js').Step} Step */
/** @typedef {import('../shared/schema.js').Precondition} Precondition */
/** @typedef {import('../shared/schema.js').FieldMap} FieldMap */
/** @typedef {import('../shared/schema.js').FieldDef} FieldDef */
/** @typedef {import('../shared/schema.js').Selectors} Selectors */
/** @typedef {import('../shared/schema.js').ResultRecipe} ResultRecipe */
/** @typedef {import('../shared/schema.js').ResultField} ResultField */

const EXAMPLE_SUFFIX = '.example';
const FIELD_TYPES = Object.freeze(['text', 'textarea', 'number', 'select', 'checkbox', 'radio', 'date', 'email', 'tel']);
const WIDGET_KINDS = Object.freeze(['listbox', 'combobox', 'datepicker', 'radio', 'checkbox', 'native']);
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
function readStep(p, raw, path) {
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
  const requiresFieldMap = p.string(raw, 'requiresFieldMap');
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
  const sourceField = p.string(raw, 'sourceField', `${path}.sourceField`);
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
    }
  }
  const selectors = readSelectors(p, raw.selectors, `${path}.selectors`);
  const dependsOn = p.stringArray(raw, 'dependsOn', `${path}.dependsOn`);
  let loadingSelector = null;
  if (raw.loadingSelector !== null && raw.loadingSelector !== undefined) {
    const ls = p.string(raw, 'loadingSelector', `${path}.loadingSelector`);
    if (ls !== undefined) loadingSelector = ls;
  }
  if (key === undefined || label === undefined || sourceField === undefined || optional === undefined
    || type === undefined || entry === undefined || selectors === undefined || dependsOn === undefined) {
    return undefined;
  }
  const credentialCandidates = [key, label, sourceField, selectors.primary, ...selectors.fallbacks];
  if (looksLikeCredential(credentialCandidates)) {
    p.add(path, `names a credential-like field ("${key}"); credentials are never filled`);
    return undefined;
  }
  return {
    key, label, sourceField, optional,
    type: /** @type {import('../shared/schema.js').FieldType} */ (type),
    maxLength, transform, entry, selectors, dependsOn, loadingSelector,
  };
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
  if (recipe.requiresFieldMap !== fieldMap.id) {
    problems.push(`recipe "${recipe.id}" requires field map "${recipe.requiresFieldMap}" but "${fieldMap.id}" was loaded`);
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
  recipe.steps.forEach((s, i) => {
    if (s.op === 'fillGroup' && s.section !== undefined && !(s.section in fieldMap.sections)) {
      problems.push(`steps[${i}] fillGroup references section "${s.section}" which the field map lacks`);
    }
    if ((s.op === 'fill' || s.op === 'select' || s.op === 'check') && s.key !== undefined && !allKeys.has(s.key)) {
      problems.push(`steps[${i}] ${s.op} references key "${s.key}" which the field map lacks`);
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
  return Ok({ recipe: shaped.value, path: fetched.value.path });
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
  return Ok({ fieldMap: shaped.value, path: fetched.value.path });
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
  return Ok({ resultRecipe: shaped.value, path: fetched.value.path });
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
  const m = await loadFieldMap(r.value.recipe.requiresFieldMap, devMode);
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
