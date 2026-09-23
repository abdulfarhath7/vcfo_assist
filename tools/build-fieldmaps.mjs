#!/usr/bin/env node
// Generate fieldmaps/<form>.json from the reference build's MCA knowledge.
//
//   node tools/build-fieldmaps.mjs
//
// Inputs (never edited here):
//   legacy/extension/lib/mapping.js            which AEM semantic key takes which profile value,
//                                              waitForOptions, notes, repeat-panel instances
//   legacy/extension/schemas/<form>.compact.json   captured label, type, max length, required
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

import { validateFieldMapShape } from '../src/engine/loader.js';
import { CREDENTIAL } from '../src/shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = path.join(ROOT, 'legacy', 'extension');
const OUT_DIR = path.join(ROOT, 'fieldmaps');

/** Forms to generate, with the section name used for fields outside repeat panels. */
const FORMS = [
  { form: 'spice-part-a', section: 'partA' },
  { form: 'spice-part-b', section: 'partB' },
  { form: 'agile-pro-s', section: 'agile' },
  { form: 'inc-9', section: 'inc9' },
  { form: 'inc-33-emoa', section: 'moa' },
  { form: 'inc-34-eaoa', section: 'aoa' },
];

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
/* Captured schema                                                           */
/* ------------------------------------------------------------------------ */

/**
 * @param {string} form
 * @returns {{ byKey: Map<string, any>, url: string }}
 */
function loadSchema(form) {
  const file = path.join(LEGACY, 'schemas', `${form}.compact.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { byKey: new Map(raw.fields.map((f) => [f.key, f])), url: raw.url ?? '' };
}

/**
 * Field type and entry from the captured AEM widget type.
 * @param {any} f   schema field, or undefined when not captured
 * @param {string} key
 */
function kindOf(f, key) {
  if (!f) return { type: 'text', entry: { mode: 'unknown', widgetKind: null }, transform: 'trim' };
  switch (f.type) {
    case 'dropdownlist':
      return { type: 'select', entry: { mode: 'widget', widgetKind: 'native' }, transform: 'trim' };
    case 'datepicker':
      return { type: 'date', entry: { mode: 'widget', widgetKind: 'datepicker' }, transform: 'dateDDMMYYYY' };
    case 'checkbox':
      // AEM renders MCA's Yes / No questions as a radio group in a "checkbox" node.
      return f.itype === 'radio'
        ? { type: 'select', entry: { mode: 'widget', widgetKind: 'radio' }, transform: YES_NO_KEYS.has(key) ? 'yesNo' : 'trim' }
        : { type: 'checkbox', entry: { mode: 'typed', widgetKind: null }, transform: '' };
    case 'checkboxgroup':
      return { type: 'checkbox', entry: { mode: 'typed', widgetKind: null }, transform: '' };
    case 'numericbox':
      return { type: 'number', entry: { mode: 'typed', widgetKind: null }, transform: 'trim' };
    case 'textbox':
      if (f.itype === 'email') return { type: 'email', entry: { mode: 'typed', widgetKind: null }, transform: 'trim' };
      if (!f.itype) return { type: 'textarea', entry: { mode: 'typed', widgetKind: null }, transform: 'trim' };
      return { type: 'text', entry: { mode: 'typed', widgetKind: null }, transform: 'trim' };
    default:
      return null; // fileupload, passwordbox: never filled
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
 * A `name__4` key mapping.js builds by index but the capture only saw as
 * `name__1`: borrow the captured sibling's widget, keep this key's position.
 * @param {{ byKey: Map<string, any> }} schema
 * @param {string} key
 */
function siblingOf(schema, key) {
  const m = /^(.+)__(\d+)$/.exec(key);
  const first = m ? schema.byKey.get(`${m[1]}__1`) : undefined;
  return first ? { ...first, key, label: `${first.label ?? m?.[1]} (${m?.[2]})`, inferred: true } : undefined;
}

/**
 * `OccupationType__2` → semantic class `OccupationType`, second occurrence.
 * @param {string} key
 * @param {any} f
 */
function semanticOf(key, f) {
  const sem = f?.sem ?? key;
  const dup = /__(\d+)$/.exec(key);
  return { sem, occurrence: sem !== key && dup ? Number(dup[1]) - 1 : null };
}

/* ------------------------------------------------------------------------ */
/* Build                                                                     */
/* ------------------------------------------------------------------------ */

const credentialRe = new RegExp(CREDENTIAL.pattern, CREDENTIAL.flags);

/**
 * @param {{ form: string, section: string }} spec
 */
function buildForm({ form, section }) {
  const schema = loadSchema(form);
  /** @type {Map<string, any>} key|instance → item, first wins */
  const items = new Map();
  /** @type {{ key: string, reason: string }[]} */
  const skipped = [];
  /** @type {Set<string>} */
  const conflicts = new Set();

  for (const variant of [{ presentAddressSame: undefined }, { presentAddressSame: false }]) {
    for (const item of MAPPING.map(form, probeProfile(variant))) {
      if (typeof item.key !== 'string' || !item.key) {
        // address() asks for a key its caller's key table does not define (e.g. `fax`).
        const from = clean(String(item.value).replace(PATH_OF, '$1')).replace(/\.\d+\./g, '[].');
        const reason = `mapping.js pushes ${from} with no field key`;
        if (!skipped.some((s) => s.reason === reason)) skipped.push({ key: '(none)', reason });
        continue;
      }
      const id = `${item.key}|${item.instance ?? ''}`;
      const m = PATH_OF.exec(String(item.value));
      if (!m) {
        if (!items.has(id) && !skipped.some((s) => s.key === item.key)) {
          skipped.push({ key: item.key, reason: 'computed by mapping.js (a count, a constant or a fallback), not read from one profile field' });
        }
        continue;
      }
      const source = clean(m[1]);
      const prev = items.get(id);
      if (prev && prev.source !== source) {
        conflicts.add(`${item.key}${item.instance !== undefined ? ` #${item.instance + 1}` : ''}: mapping.js writes both ${prev.source} and ${source}; kept ${prev.source}`);
        continue;
      }
      if (!prev) items.set(id, { ...item, source });
    }
  }

  /** @type {Record<string, any[]>} */
  const sections = { [section]: [] };
  const seenKeys = new Set();
  for (const item of items.values()) {
    const f = schema.byKey.get(item.key) ?? siblingOf(schema, item.key);
    const kind = kindOf(f, item.key);
    if (!kind) {
      skipped.push({ key: item.key, reason: `captured as ${f.type}; not filled` });
      continue;
    }
    const instanced = item.instance !== undefined;
    const { sourceField, block, row } = toSourceField(item.source, instanced);
    const label = labelOf(f, item.key);
    if ([item.key, label, sourceField].some((c) => credentialRe.test(c))) {
      skipped.push({ key: item.key, reason: 'looks like a credential field; never filled' });
      continue;
    }
    const { sem, occurrence } = semanticOf(item.key, f);
    const instance = (occurrence ?? 0) + (instanced ? item.instance : 0);
    const addressed = instanced || occurrence !== null;
    const sectionName = block === null ? section : `${block}_${row + 1}`;
    const key = instanced ? `${item.key}#${item.instance + 1}` : item.key;
    if (seenKeys.has(key)) {
      conflicts.add(`${key}: emitted twice; kept the first`);
      continue;
    }
    seenKeys.add(key);

    /** @type {Record<string, unknown>} */
    const selectors = { strategy: 'guideFieldNode', key: sem };
    if (addressed) selectors.instance = instance;
    // Not in the capture, or a duplicate class whose position depends on how many rows sit above it.
    if (!f || f.inferred || (occurrence !== null && instanced)) selectors.stability = 'fragile';

    const entry = {
      key,
      label,
      sourceField,
      // A repeat row the engagement does not have is simply absent.
      optional: instanced || !f?.req,
      type: kind.type,
      maxLength: f?.max ? Number(f.max) : null,
      transform: kind.transform,
      entry: kind.entry,
      selectors,
      dependsOn: [],
      loadingSelector: null,
      ...(item.waitForOptions ? { waitForOptions: true } : {}),
      ...(item.note ? { note: item.note } : {}),
    };
    (sections[sectionName] ??= []).push(entry);
  }

  // mapping.js fills in order and lets a waitForOptions field wait for whatever
  // it filled just before (type → class → category; PIN code → area). Say so.
  for (const fields of Object.values(sections)) {
    fields.forEach((f, i) => {
      if (f.waitForOptions && i > 0) f.dependsOn = [fields[i - 1].key];
    });
  }

  const captured = [...items.values()].filter((i) => schema.byKey.has(i.key)).length;
  const fragile = Object.values(sections).flat().filter((f) => f.selectors.stability === 'fragile').length;
  return {
    id: form,
    version: 1,
    origin: 'https://www.mca.gov.in',
    framework: 'aem',
    requiresSchemaVersion: 1,
    capturedFrom: `legacy/extension/schemas/${form}.compact.json (${schema.url || 'MCA V3'}, captured 2026-09-23) + legacy/extension/lib/mapping.js`,
    _note: `Generated by tools/build-fieldmaps.mjs — do not edit by hand; fix legacy/extension/lib/mapping.js and regenerate. ${captured} of ${items.size} mapped keys are in the captured schema; ${fragile} fields are marked fragile (not captured, or a repeated class whose position depends on the rows above it).`,
    ...(skipped.length ? { _skipped: skipped } : {}),
    ...(conflicts.size ? { _conflicts: [...conflicts] } : {}),
    sections,
  };
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

fs.mkdirSync(OUT_DIR, { recursive: true });
let failed = false;
/** @type {Array<{ form: string, map: any }>} */
const built = [];
for (const spec of FORMS) {
  const map = buildForm(spec);
  const checked = validateFieldMapShape(map, `fieldmaps/${spec.form}.json`);
  if (!checked.ok) {
    failed = true;
    console.error(`✗ ${spec.form}: ${checked.error.message}`);
    continue;
  }
  fs.writeFileSync(path.join(OUT_DIR, `${spec.form}.json`), `${JSON.stringify(map, null, 2)}\n`);
  built.push({ form: spec.form, map });
  const count = Object.values(map.sections).reduce((n, list) => n + list.length, 0);
  console.log(`✓ fieldmaps/${spec.form}.json — ${count} fields in ${Object.keys(map.sections).length} sections, ${map._skipped?.length ?? 0} skipped, ${map._conflicts?.length ?? 0} conflicts`);
}
console.log('Suite contract (docs/00-profile-contract.md):');
if (!checkContract(built)) failed = true;
if (failed) process.exit(1);
