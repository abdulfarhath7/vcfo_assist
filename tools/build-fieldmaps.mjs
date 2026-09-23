#!/usr/bin/env node
// Generate fieldmaps/<form>.json and recipes/<form>.json from the captured
// MCA knowledge.
//
//   node tools/build-fieldmaps.mjs
//
// Inputs (never edited here):
//   legacy/extension/lib/mapping.js            which AEM semantic key takes which profile value,
//                                              waitForOptions, notes, repeat-panel instances
//   schemas-full/<form>.json                   every captured field: key, label, AEM type,
//                                              semantic classes, mandatory, widget, panels
//
// How: mapping.js is run against a *probe* profile whose every leaf is a marker
// naming its own path (`§company.nicCode§`). Whatever key mapping.js pushes with
// a marker as its value is a field fed straight from that profile path. A key
// pushed with any other value is computed by mapping.js (a count, a constant, a
// fallback) and is listed under `_skipped` instead, with the reason.
//
// Addressing is never converted to CSS: every field carries
//   "selectors": { "strategy": "guideFieldNode", "key": <semantic class>, "instance"? }
// which src/content/lib/resolve.js resolves the way legacy filler.js does.
//
// Repeat panels. mapping.js splits subscribers and directors into the portal's
// blocks (6a body corporate, 6b individual with DIN, 6c without DIN; 7a director
// with DIN, 7b without) and numbers rows within each block. The field map keeps
// that split in `sourceField`, e.g. `directors[withDin].0.din`; the Suite client
// builds the same partitions when it binds the profile (src/suite/profile.js).
//
// The output is validated with the extension's own loader before it is written.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { validateFieldMapShape, validateRecipeShape, checkCompatibility } from '../src/engine/loader.js';
import { CREDENTIAL } from '../src/shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = path.join(ROOT, 'legacy', 'extension');
const OUT_DIR = path.join(ROOT, 'fieldmaps');

/** Rows probed per repeat block. The portal shows one until the lead clicks Add. */
const ROWS = { subscribers: 3, directors: 5, interests: 3, otherDirectors: 3 };

/* ------------------------------------------------------------------------ */
/* mapping.js                                                                */
/* ------------------------------------------------------------------------ */

const mappingSrc = fs.readFileSync(path.join(LEGACY, 'lib', 'mapping.js'), 'utf8');
const sandbox = /** @type {Record<string, any>} */ ({});
vm.runInNewContext(mappingSrc, sandbox, { filename: 'mapping.js' });
const MAPPING = sandbox.VCFO_MAPPING;
if (!MAPPING || typeof MAPPING.map !== 'function') throw new Error('legacy mapping.js did not install VCFO_MAPPING');

/** Keys whose value mapping.js passes through YN(): MCA Yes / No radios. */
const YES_NO_KEYS = new Set([...mappingSrc.matchAll(/push\(\s*\w+\s*,\s*'([^']+)'\s*,\s*YN\(/g)].map((m) => m[1]));

/* ------------------------------------------------------------------------ */
/* Probe profile                                                             */
/* ------------------------------------------------------------------------ */

const MARK = '§';
const PATH_OF = /^§(.+)§$/;

/**
 * An object that answers every property with a deeper probe and stringifies
 * to its own path marker. `overrides` pins properties mapping.js branches on.
 * @param {string} p
 * @param {Record<string, unknown>} [overrides]
 * @returns {any}
 */
function probe(p, overrides = {}) {
  const marker = `${MARK}${p}${MARK}`;
  const target = Object.assign(new String(marker), overrides);
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'symbol') {
        const v = Reflect.get(t, prop);
        return typeof v === 'function' ? v.bind(t) : v;
      }
      if (prop === 'toString' || prop === 'valueOf') return () => marker;
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop];
      if (prop === 'then' || prop === 'toJSON') return undefined;
      return probe(`${p}.${prop}`);
    },
  });
}

/**
 * @param {string} p
 * @param {number} n
 * @param {(i: number) => Record<string, unknown>} [overridesFor]
 * @returns {any[]}
 */
function rows(p, n, overridesFor = () => ({})) {
  return Array.from({ length: n }, (_, i) => probe(`${p}.${i}`, overridesFor(i)));
}

/**
 * Probe layout. Subscribers: body corporate, then individual with DIN, then
 * individual without DIN; none is a director, so mapping.js's director blocks
 * see `directors[]` only. Directors: with DIN, then without. Other-company
 * interests only on the first director with DIN (mapping.js addresses them by
 * a form-wide instance, so a second director's rows would collide).
 * @param {{ presentAddressSame: boolean | undefined }} variant
 */
function probeProfile(variant) {
  const S = ROWS.subscribers;
  const D = ROWS.directors;
  const present = variant.presentAddressSame === undefined ? {} : { presentAddressSame: variant.presentAddressSame };
  const subscribers = rows('subscribers', S * 3, (i) => {
    if (i < S) return { kind: 'bodyCorporate', isDirector: false, interests: [] };
    if (i < 2 * S) return { kind: 'individual', isDirector: false, interests: [], ...present };
    return { kind: 'individual', isDirector: false, din: '', interests: [], ...present };
  });
  const directors = rows('directors', D * 2, (i) => ({
    ...(i < D ? {} : { din: '' }),
    interests: i === 0 ? rows('directors.0.interests', ROWS.interests) : [],
    ...present,
  }));
  return probe('', {
    company: probe('company', { proposedNames: rows('company.proposedNames', 2) }),
    subscribers,
    directors,
    agile: probe('agile', { otherDirectors: rows('agile.otherDirectors', ROWS.otherDirectors) }),
  });
}

/**
 * Probe paths are `.company.nicCode` (root has an empty path); strip the dot.
 * @param {string} p
 */
const clean = (p) => p.replace(/^\./, '');

/**
 * Turn a probe element path into the sourceField the map uses. Items mapping.js
 * addresses by repeat-panel instance use the block partition and the row within
 * it; everything else keeps the plain profile path.
 * @param {string} p        e.g. `directors.6.firstName`
 * @param {boolean} instanced
 * @returns {{ sourceField: string, block: string | null, row: number | null }}
 */
function toSourceField(p, instanced) {
  const S = ROWS.subscribers;
  const D = ROWS.directors;
  let m = /^subscribers\.(\d+)\.(.+)$/.exec(p);
  if (m && instanced) {
    const i = Number(m[1]);
    const [block, row] = i < S ? ['bodyCorporate', i] : i < 2 * S ? ['individualWithDin', i - S] : ['individualWithoutDin', i - 2 * S];
    return { sourceField: `subscribers[${block}].${row}.${m[2]}`, block: `subscriber_${block}`, row };
  }
  m = /^directors\.(\d+)\.(.+)$/.exec(p);
  if (m && instanced) {
    const i = Number(m[1]);
    const [block, row] = i < D ? ['withDin', i] : ['withoutDin', i - D];
    return { sourceField: `directors[${block}].${row}.${m[2]}`, block: `director_${block}`, row };
  }
  m = /^agile\.otherDirectors\.(\d+)\.(.+)$/.exec(p);
  if (m && instanced) return { sourceField: p, block: 'otherDirector', row: Number(m[1]) };
  return { sourceField: p, block: null, row: null };
}

/* ------------------------------------------------------------------------ */
/* Captured schema (schemas-full)                                            */
/* ------------------------------------------------------------------------ */

/** AEM node types that take a value. Text draws and buttons are not fields. */
const INPUT_TYPES = new Set([
  'guideTextBox', 'guideNumericBox', 'guideDropDownList', 'guideDatePicker', 'guideCheckBox', 'guideCheckBoxGroup',
]);
/** Captured, but a person does these: attach a file. */
const MANUAL_TYPES = new Set(['guideFileUpload', 'guidePasswordBox']);
/** Classes AEM adds beside the semantic one. */
const GENERIC_CLASS = /^(guide|af-|defaultFieldLayout|mca-|mb-\d|container$|input-search)/;

/**
 * @param {string} form
 */
function loadSchema(form) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas-full', `${form}.json`), 'utf8'));
  /** @type {any[]} */
  const all = raw.fields;
  return {
    url: raw.url ?? '',
    source: raw.source ?? '',
    inputs: all.filter((f) => INPUT_TYPES.has(f.type)),
    byKey: new Map(all.map((f) => [f.key, f])),
    counts: {
      notFields: all.filter((f) => f.type === 'guideTextDraw' || f.type === 'guideButton').length,
      manual: all.filter((f) => MANUAL_TYPES.has(f.type)).length,
    },
  };
}

/**
 * Field type, entry mode and transform from the captured AEM node type.
 * @param {any} f
 * @param {string} key   mapping.js key, for the Yes / No decision
 */
function kindOf(f, key) {
  const w = f.widget ?? {};
  switch (f.type) {
    case 'guideDropDownList':
      return { type: 'select', entry: { mode: 'widget', widgetKind: 'native' }, transform: 'trim' };
    case 'guideDatePicker':
      return { type: 'date', entry: { mode: 'widget', widgetKind: 'datepicker' }, transform: 'dateDDMMYYYY' };
    case 'guideCheckBox':
      // MCA's Yes / No questions: a radio group in a "checkbox" node.
      return w.type === 'radio'
        ? { type: 'select', entry: { mode: 'widget', widgetKind: 'radio' }, transform: YES_NO_KEYS.has(key) ? 'yesNo' : 'trim' }
        : { type: 'checkbox', entry: { mode: 'typed', widgetKind: null }, transform: '' };
    case 'guideCheckBoxGroup':
      return { type: 'checkbox', entry: { mode: 'typed', widgetKind: null }, transform: '' };
    case 'guideNumericBox':
      return { type: 'number', entry: { mode: 'typed', widgetKind: null }, transform: 'trim' };
    default:
      if (w.tag === 'select') return { type: 'select', entry: { mode: 'widget', widgetKind: 'native' }, transform: 'trim' };
      if (w.tag === 'textarea') return { type: 'textarea', entry: { mode: 'typed', widgetKind: null }, transform: 'trim' };
      if (w.type === 'email') return { type: 'email', entry: { mode: 'typed', widgetKind: null }, transform: 'trim' };
      return { type: 'text', entry: { mode: 'typed', widgetKind: null }, transform: 'trim' };
  }
}

/**
 * @param {any} f
 * @param {string} key
 */
function labelOf(f, key) {
  const label = String(f?.label ?? '').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
  if (label.length < 4 || /^[IVX]+\.?$/.test(label)) return label ? `${key} (${label})` : key;
  return label;
}

/**
 * The semantic class and, for a `name__n` key, which occurrence of it this is.
 * @param {any} f
 */
function semanticOf(f) {
  const sem = (f.semantic ?? []).find((c) => !GENERIC_CLASS.test(c)) ?? f.key;
  const dup = /__(\d+)$/.exec(f.key);
  return { sem, occurrence: sem !== f.key && dup ? Number(dup[1]) - 1 : null };
}

/* ------------------------------------------------------------------------ */
/* Build                                                                     */
/* ------------------------------------------------------------------------ */

const credentialRe = new RegExp(CREDENTIAL.pattern, CREDENTIAL.flags);

/**
 * Every captured input becomes an entry; mapping.js supplies the binding
 * where it has one. A binding whose key the capture never saw is drift.
 * @param {string} form
 */
function buildForm(form) {
  const schema = loadSchema(form);
  /** @type {Map<string, any>} key|instance → mapping item, first wins */
  const items = new Map();
  /** @type {any[]} mapping order of the first probe run, for dependsOn */
  const order = [];
  /** @type {{ key: string, reason: string }[]} */
  const skipped = [];
  /** @type {Set<string>} */
  const conflicts = new Set();
  /** @type {Set<string>} */
  const drift = new Set();

  [{ presentAddressSame: undefined }, { presentAddressSame: false }].forEach((variant, run) => {
    for (const item of MAPPING.map(form, probeProfile(variant))) {
      if (typeof item.key !== 'string' || !item.key) {
        // address() asks for a key its caller's key table does not define (e.g. `fax`).
        const from = clean(String(item.value).replace(PATH_OF, '$1')).replace(/\.\d+\./g, '[].');
        const reason = `mapping.js pushes ${from} with no field key`;
        if (!skipped.some((x) => x.reason === reason)) skipped.push({ key: '(none)', reason });
        continue;
      }
      const id = `${item.key}|${item.instance ?? ''}`;
      const m = PATH_OF.exec(String(item.value));
      if (!m) {
        if (!items.has(id) && !skipped.some((x) => x.key === item.key)) {
          skipped.push({ key: item.key, reason: 'computed by mapping.js (a count, a constant or a fallback), not read from one profile field' });
        }
        continue;
      }
      const source = clean(m[1]);
      const prev = items.get(id);
      if (prev) {
        if (prev.source !== source) conflicts.add(`${item.key}${item.instance !== undefined ? ` #${item.instance + 1}` : ''}: mapping.js writes both ${prev.source} and ${source}; kept ${prev.source}`);
        continue;
      }
      const entry = { ...item, source };
      items.set(id, entry);
      if (run === 0) order.push(entry);
    }
  });

  // Drift: a mapping.js key the capture does not have. `name__4` is fine when
  // the capture has `name__1` — mapping.js numbers rows beyond the one captured.
  /** @type {Map<string, any>} key → schema field it rides on */
  const siblings = new Map();
  for (const item of items.values()) {
    const f = schema.byKey.get(item.key);
    if (f) {
      if (!INPUT_TYPES.has(f.type)) drift.add(`${item.key}: mapping.js binds it, but the capture has it as ${f.type}`);
      continue;
    }
    const m = /^(.+)__(\d+)$/.exec(item.key);
    const first = m ? schema.byKey.get(`${m[1]}__1`) : undefined;
    if (first && INPUT_TYPES.has(first.type)) siblings.set(item.key, first);
    else drift.add(`${item.key}: mapping.js binds it, but schemas-full/${form}.json has no such field`);
  }

  /**
   * Entry key for a mapping item: the captured key for the first row, `#n` after.
   * @param {any} item
   */
  const entryKey = (item) => (item.instance ? `${item.key}#${item.instance + 1}` : item.key);

  /**
   * @param {any} f          schema field
   * @param {string} key     entry key
   * @param {any | null} item mapping item, or null when unbound
   * @param {{ inferred?: boolean, occurrenceOverride?: number }} [opt]
   */
  const makeEntry = (f, key, item, opt = {}) => {
    const kind = kindOf(f, item?.key ?? f.key);
    const { sem, occurrence: captured } = semanticOf(f);
    const occurrence = opt.occurrenceOverride ?? captured;
    const instanced = item?.instance !== undefined;
    const bound = item ? toSourceField(item.source, instanced).sourceField : null;
    /** @type {Record<string, unknown>} */
    const selectors = { strategy: 'guideFieldNode', key: sem };
    if (instanced || occurrence !== null) selectors.instance = (occurrence ?? 0) + (instanced ? item.instance : 0);
    // Not captured as such, or a repeated class whose position depends on the rows above it.
    if (opt.inferred || (occurrence !== null && instanced && item.instance > 0)) selectors.stability = 'fragile';
    const maxLength = Number(f.widget?.maxlength ?? 0);
    return {
      key,
      label: opt.inferred ? `${labelOf(f, key)} (${key})` : labelOf(f, key),
      sourceField: bound,
      // Unbound: real and fillable, just not bound yet. A repeat row the engagement lacks is absent.
      optional: bound === null || instanced || !f.mandatory,
      type: kind.type,
      maxLength: maxLength > 0 ? maxLength : null,
      transform: kind.transform,
      entry: kind.entry,
      selectors,
      dependsOn: [],
      loadingSelector: null,
      waitForOptions: Boolean(item?.waitForOptions),
      note: item?.note ?? null,
      ...(f.panels?.length ? { panels: f.panels } : {}),
    };
  };

  /** @type {any[]} */
  const entries = [];
  /** @type {Map<any, string>} mapping item → entry key */
  const keyOfItem = new Map();
  const byKey = [...items.values()].reduce((acc, it) => acc.set(it.key, [...(acc.get(it.key) ?? []), it]), new Map());
  let credentialFields = 0;
  for (const f of schema.inputs) {
    // OTP, captcha, password: the lead's alone. Never listed, never filled.
    if ([f.key, f.label ?? '', ...(f.semantic ?? [])].some((c) => credentialRe.test(c))) {
      credentialFields += 1;
      if ((byKey.get(f.key) ?? []).length) drift.add(`${f.key}: mapping.js binds a credential-like field`);
      continue;
    }
    const rowsOf = (byKey.get(f.key) ?? []).sort((x, y) => (x.instance ?? 0) - (y.instance ?? 0));
    if (rowsOf.length === 0) {
      entries.push(makeEntry(f, f.key, null));
      continue;
    }
    for (const it of rowsOf) {
      const key = entryKey(it);
      if (credentialRe.test(key) || credentialRe.test(it.source)) {
        skipped.push({ key, reason: 'looks like a credential field; never filled' });
        continue;
      }
      entries.push(makeEntry(f, key, it));
      keyOfItem.set(it, key);
    }
    // Rows mapping.js numbers past the captured `name__1` ride on it.
    for (const [k, first] of siblings) {
      if (first !== f) continue;
      for (const it of byKey.get(k) ?? []) {
        const n = Number(/__(\d+)$/.exec(k)?.[1] ?? 1);
        entries.push(makeEntry(first, entryKey(it), it, { inferred: true, occurrenceOverride: n - 1 }));
        keyOfItem.set(it, entryKey(it));
      }
    }
  }

  // mapping.js fills in order and lets a waitForOptions field wait for whatever
  // it filled just before (type → class → category; PIN code → area). Say so.
  const byEntryKey = new Map(entries.map((e) => [e.key, e]));
  order.forEach((it, i) => {
    if (!it.waitForOptions || i === 0) return;
    const self = byEntryKey.get(keyOfItem.get(it));
    const before = keyOfItem.get(order[i - 1]);
    if (self && before && byEntryKey.has(before)) self.dependsOn = [before];
  });

  const bound = entries.filter((e) => e.sourceField !== null).length;
  const summary = {
    total: entries.length,
    bound,
    unbound: entries.length - bound,
    notes: entries.filter((e) => e.note).length,
    waitForOptions: entries.filter((e) => e.waitForOptions).length,
    fragile: entries.filter((e) => e.selectors.stability === 'fragile').length,
    notFields: schema.counts.notFields,
    manual: schema.counts.manual,
    credential: credentialFields,
    computed: skipped.length,
  };
  const map = {
    id: form,
    version: 2,
    origin: 'https://www.mca.gov.in',
    framework: 'aem',
    requiresSchemaVersion: 1,
    capturedFrom: `schemas-full/${form}.json (${schema.url}; ${schema.source}) + legacy/extension/lib/mapping.js`,
    _note: `Generated by tools/build-fieldmaps.mjs — do not edit by hand. ${summary.total} captured inputs, ${summary.bound} bound to a profile field, ${summary.unbound} unbound (sourceField null, optional). ${summary.notFields} text blocks and buttons, ${summary.manual} file uploads and ${summary.credential} OTP / credential inputs are not listed.`,
    _summary: summary,
    ...(skipped.length ? { _skipped: skipped } : {}),
    ...(conflicts.size ? { _conflicts: [...conflicts] } : {}),
    sections: { all: entries },
  };
  return { map, drift: [...drift], summary };
}

/* ------------------------------------------------------------------------ */
/* Suite contract check                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Keys docs/00-profile-contract.md names, as normalised paths
 * (`directors[].father.firstName`), plus `.*` prefixes and the top-level
 * sections from its table.
 */
function readContract() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', '00-profile-contract.md'), 'utf8');
  const sections = new Set([...doc.matchAll(/^\|\s*`([A-Za-z]+)(?:\[\])?`\s*\|/gm)].map((m) => m[1]));
  /** @type {Set<string>} */
  const named = new Set();
  /** @type {string[]} */
  const prefixes = [];
  for (const block of doc.split(/^## /m).slice(1)) {
    const heading = block.slice(0, block.indexOf('\n'));
    const roots = [...heading.matchAll(/([A-Za-z]+)(\[\])?/g)]
      .filter((m) => sections.has(m[1]))
      .map((m) => `${m[1]}${m[2] ?? ''}`);
    if (!roots.length) continue;
    for (const [, token] of block.matchAll(/`([A-Za-z][\w.|*\[\]]*)`/g)) {
      const [first, ...alts] = token.split('|');
      const base = first.includes('.') ? first.slice(0, first.lastIndexOf('.') + 1) : '';
      for (let t of [first, ...alts.map((a) => base + a)]) {
        // File names, literals and words about the contract rather than in it.
        if (/\.(js|ts|json)$/.test(t) || ['true', 'false', 'missing', 'notes', 'instance', 'waitForOptions'].includes(t)) continue;
        // The company table writes capital classes without their `capital.` parent.
        if (roots.includes('company') && /^(equity|preference)\./.test(t)) t = `capital.${t}`;
        for (const root of roots) {
          if (t.endsWith('.*')) prefixes.push(`${root}.${t.slice(0, -2)}.`);
          else if (t.endsWith('[]')) prefixes.push(`${root}.${t}.`);
          named.add(`${root}.${t}`);
        }
      }
    }
  }
  return { sections, named, prefixes };
}

/**
 * `directors[withDin].0.interests.1.cin` → `directors[].interests[].cin`.
 * @param {string} sourceField
 */
function normalisePath(sourceField) {
  return sourceField.replace(/\[[^\]]*\]\.\d+/g, '[]').replace(/\.\d+(?=\.|$)/g, '[]');
}

/**
 * Every sourceField must sit in a section the contract defines. Report which
 * use names the contract spells out and which it does not name (Suite never
 * sends those; they stay unfilled). A contract key no map reads is listed too.
 * @param {Array<{ form: string, map: any }>} built
 * @returns {boolean} ok
 */
function checkContract(built) {
  const { sections, named, prefixes } = readContract();
  let ok = true;
  const used = new Set();
  for (const { form, map } of built) {
    let inContract = 0;
    /** @type {Set<string>} */
    const unnamed = new Set();
    for (const f of Object.values(map.sections).flat()) {
      if (f.sourceField === null) continue;
      const p = normalisePath(f.sourceField);
      const root = p.split(/[.[]/)[0];
      if (!sections.has(root)) {
        ok = false;
        console.error(`✗ ${form}: ${f.key} reads "${f.sourceField}", outside every section of docs/00-profile-contract.md`);
        continue;
      }
      if (named.has(p) || prefixes.some((pre) => p.startsWith(pre))) {
        inContract += 1;
        used.add(p);
      } else unnamed.add(p);
    }
    console.log(`  ${form}: ${inContract} fields read contract-named keys; ${unnamed.size} distinct paths the contract does not name`);
  }
  const unread = [...named].filter((k) => !used.has(k) && !k.endsWith('.*') && /^(company|registeredOffice|directors\[\])\.[a-z]/.test(k) && !prefixes.some((pre) => pre === `${k}.`));
  if (unread.length) {
    console.log(`  named by the contract but read by no field map (computed by mapping.js, a partition input, or informational): ${unread.join(', ')}`);
  }
  return ok;
}

const FORM_IDS = ['spice-part-a', 'spice-part-b', 'agile-pro-s', 'inc-9', 'inc-33-emoa', 'inc-34-eaoa'];

/* ------------------------------------------------------------------------ */
/* Recipes                                                                   */
/* ------------------------------------------------------------------------ */

const RECIPE_DIR = path.join(ROOT, 'recipes');

/** Panel labels and the halt message per form. */
const FORM_TEXT = /** @type {Record<string, { label: string, halt: string }>} */ ({
  'spice-part-a': {
    label: 'SPICe+ Part A — name reservation',
    halt: 'Review every field, pick the NIC row from the popup table, then submit yourself. VCFO Assist does not submit.',
  },
  'spice-part-b': { label: 'SPICe+ Part B — incorporation', halt: 'Review every field, attach the documents, then save or submit yourself. VCFO Assist does not submit, sign or pay.' },
  'agile-pro-s': { label: 'AGILE-PRO-S (INC-35)', halt: 'Review every field and answer the declarations, then save yourself. OTP verification is yours. VCFO Assist does not submit.' },
  'inc-9': { label: 'INC-9 — declaration by subscribers and directors', halt: 'Review every field, then save yourself. VCFO Assist does not submit or sign.' },
  'inc-33-emoa': { label: 'INC-33 — e-Memorandum of Association', halt: 'Review every field, then save yourself. VCFO Assist does not submit or sign.' },
  'inc-34-eaoa': { label: 'INC-34 — e-Articles of Association', halt: 'Review every field, then save yourself. VCFO Assist does not submit or sign.' },
});

/**
 * A class name as a CSS identifier (`2b-ni-pan-dsc` → `\\32 b-ni-pan-dsc`).
 * @param {string} name
 */
function cssIdent(name) {
  return name.replace(/^(\d)/, (d) => `\\3${d} `).replace(/[^\w-\\ ]/g, (c) => `\\${c}`);
}

/**
 * One recipe per form: log-in precondition, straight to the captured URL, wait
 * for the first mandatory field, fill everything, halt. No menu, no humanGate.
 * @param {string} form
 * @param {any} map
 */
function buildRecipe(form, map) {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas-full', 'index.json'), 'utf8'));
  const url = index.find((e) => e.form === form)?.url;
  if (!url) throw new Error(`schemas-full/index.json has no URL for ${form}`);
  // The form's first mandatory, enabled input: present once the form itself has
  // rendered, unlike the guideContainer root (QUESTIONS Q31).
  const schema = loadSchema(form);
  // `disabled` is the capture-time state (prefilled from Part A); it still renders.
  const first = schema.inputs.find((f) => f.mandatory && !(f.panels ?? []).length)
    ?? schema.inputs.find((f) => String(f.label ?? '').trim().length > 3 && !(f.panels ?? []).length);
  if (!first) throw new Error(`${form}: no captured input to wait on`);
  const { sem } = semanticOf(first);
  const selector = `.guideFieldNode.${cssIdent(sem)}`;
  return {
    id: form,
    version: 2,
    label: FORM_TEXT[form].label,
    origin: 'https://www.mca.gov.in',
    requiresFieldMap: form,
    requiresFieldMapVersion: map.version,
    requiresSchemaVersion: 1,
    _note: `Generated by tools/build-fieldmaps.mjs from schemas-full/index.json. The form is ready when ${selector} ("${labelOf(first, first.key)}", the first ${first.mandatory ? 'mandatory' : 'labelled'} field) is visible.`,
    preconditions: [
      {
        op: 'assertLoggedIn',
        selector: '#welcomeUser',
        message: 'Log in to MCA first. VCFO Assist does not log in for you.',
      },
    ],
    steps: [
      { op: 'navigate', url, label: `Open ${FORM_TEXT[form].label}` },
      { op: 'waitFor', selector, timeoutMs: 30000, label: 'Form rendered' },
      { op: 'fillGroup', section: 'all', label: `Fill ${FORM_TEXT[form].label.split(' — ')[0]}` },
      { op: 'halt', reason: FORM_TEXT[form].halt },
    ],
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let failed = false;
/** @type {Array<{ form: string, map: any }>} */
const built = [];
console.log('form            total  bound  unbound  notes  waitForOptions  fragile  | not fields  file uploads  OTP/credential  computed');
for (const form of FORM_IDS) {
  const { map, drift, summary: s } = buildForm(form);
  if (drift.length) {
    failed = true;
    console.error(`✗ ${form}: mapping.js and the capture have drifted — ${drift.length} binding${drift.length === 1 ? '' : 's'} with no captured field:`);
    for (const d of drift) console.error(`    ${d}`);
    continue;
  }
  const checked = validateFieldMapShape(map, `fieldmaps/${form}.json`);
  if (!checked.ok) {
    failed = true;
    console.error(`✗ ${form}: ${checked.error.message}`);
    continue;
  }
  const recipe = buildRecipe(form, map);
  const recipeChecked = validateRecipeShape(recipe, `recipes/${form}.json`);
  const compatible = recipeChecked.ok ? checkCompatibility(recipeChecked.value, checked.value) : recipeChecked;
  if (!compatible.ok) {
    failed = true;
    console.error(`✗ ${form} recipe: ${compatible.error.message}`);
    continue;
  }
  fs.writeFileSync(path.join(OUT_DIR, `${form}.json`), `${JSON.stringify(map, null, 2)}\n`);
  fs.writeFileSync(path.join(RECIPE_DIR, `${form}.json`), `${JSON.stringify(recipe, null, 2)}\n`);
  built.push({ form, map });
  const pad = (v, n) => String(v).padStart(n);
  console.log(`${form.padEnd(14)} ${pad(s.total, 6)} ${pad(s.bound, 6)} ${pad(s.unbound, 8)} ${pad(s.notes, 6)} ${pad(s.waitForOptions, 15)} ${pad(s.fragile, 8)}  | ${pad(s.notFields, 10)} ${pad(s.manual, 13)} ${pad(s.credential, 15)} ${pad(s.computed, 9)}`);
}
console.log('Suite contract (docs/00-profile-contract.md):');
if (built.length && !checkContract(built)) failed = true;
if (failed) {
  console.error('Field maps not written for the forms above. Fix legacy/extension/lib/mapping.js or re-capture, then rerun.');
  process.exit(1);
}
