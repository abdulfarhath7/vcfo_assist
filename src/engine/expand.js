// Repeat groups. A recipe step `{ op: "forEach", over: "promoters", max: 20, steps: [...] }`
// is expanded for one payload into plain steps, once per row the payload holds
// (`promoters.1.*`, `promoters.2.*`, … — Suite's rows are 1-based). A fillGroup
// inside names a template section whose sourceFields carry `{n}`; the expander
// clones that section per row (`promoter@2`), with `{n}` replaced in every
// sourceField and the keys suffixed so they stay unique. Template sections are
// then dropped from the map. The result is deterministic for a payload, so a
// worker that restarts mid-run rebuilds exactly the same steps.

/** @typedef {import('../shared/schema.js').Recipe} Recipe */
/** @typedef {import('../shared/schema.js').Step} Step */
/** @typedef {import('../shared/schema.js').FieldMap} FieldMap */
/** @typedef {import('../shared/schema.js').FieldDef} FieldDef */
/** @typedef {import('../shared/schema.js').SuitePayload} SuitePayload */

/**
 * How many rows the payload holds for a repeat prefix: the highest contiguous
 * N from 1 for which a `prefix.N.*` key (a row) or a `prefix.N` key (a list item)
 * exists in `payload.fields`.
 * @param {SuitePayload} payload
 * @param {string} prefix
 * @returns {number}
 */
export function rowCount(payload, prefix) {
  /** @type {Set<number>} */
  const seen = new Set();
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)(?:\\.|$)`);
  for (const k of Object.keys(payload.fields)) {
    const m = re.exec(k);
    if (m) seen.add(Number(m[1]));
  }
  let n = 0;
  while (seen.has(n + 1)) n += 1;
  return n;
}

/**
 * @param {string | undefined} text
 * @param {number} n
 * @param {number} count
 * @returns {string | undefined}
 */
function fill(text, n, count) {
  return text === undefined ? undefined : text.replace(/\{n\}/g, String(n)).replace(/\{count\}/g, String(count));
}

/**
 * Clone a template section for row n.
 * @param {FieldDef[]} fields
 * @param {number} n
 * @returns {FieldDef[]}
 */
function cloneSection(fields, n) {
  return fields.map((f) => ({
    ...f,
    key: `${f.key}@${n}`,
    label: fill(f.label, n, 0) ?? f.label,
    sourceField: f.sourceField === null ? null : f.sourceField.replace(/\{n\}/g, String(n)),
    dependsOn: f.dependsOn.map((d) => `${d}@${n}`),
    ...(f.verifyIn ? { verifyIn: f.verifyIn } : {}),
  }));
}

/**
 * Expand every forEach for this payload.
 * @param {Recipe} recipe
 * @param {FieldMap} fieldMap
 * @param {SuitePayload} payload
 * @returns {{ recipe: Recipe, fieldMap: FieldMap }}
 */
export function expandForPayload(recipe, fieldMap, payload) {
  if (!recipe.steps.some((s) => s.op === 'forEach')) return { recipe, fieldMap };
  /** @type {Record<string, FieldDef[]>} */
  const sections = { ...fieldMap.sections };
  /** @type {Set<string>} */
  const templates = new Set();
  /** @type {Step[]} */
  const steps = [];
  for (const s of recipe.steps) {
    if (s.op !== 'forEach') {
      steps.push(s);
      continue;
    }
    const count = Math.min(rowCount(payload, s.over ?? ''), s.max ?? 99);
    for (const inner of s.steps ?? []) if (inner.section) templates.add(inner.section);
    for (let n = 1; n <= count; n++) {
      for (const inner of s.steps ?? []) {
        /** @type {Step} */
        const out = { ...inner, instance: n };
        if (inner.label !== undefined) out.label = fill(inner.label, n, count);
        if (inner.message !== undefined) out.message = fill(inner.message, n, count);
        if (inner.section) {
          const name = `${inner.section}@${n}`;
          if (!sections[name]) sections[name] = cloneSection(fieldMap.sections[inner.section] ?? [], n);
          out.section = name;
        }
        steps.push(out);
      }
    }
  }
  for (const t of templates) delete sections[t];
  return { recipe: { ...recipe, steps }, fieldMap: { ...fieldMap, sections } };
}
