// Panel 2 — Verify. Every field the map will fill: label, value, source
// field. This is the only panel that displays engagement values in full,
// and the table is never collapsible. Edit is not offered.

import { MSG } from '../../shared/constants.js';
import { h, chip, code, replace } from '../dom.js';

/** @typedef {import('../context.js').ViewContext} ViewContext */
/** @typedef {import('../../shared/schema.js').VerifyRow} VerifyRow */

/**
 * @param {VerifyRow} row
 * @returns {HTMLElement}
 */
function valueCell(row) {
  if (!row.hasValue) {
    return h('td', { class: 'value' }, chip('no value', 'waiting'), row.optional ? h('span', { class: 'meta' }, 'optional — will be skipped') : h('span', { class: 'meta' }, 'required'), row.warning ? h('span', { class: 'meta' }, row.warning) : null);
  }
  return h('td', { class: 'value' },
    row.value ?? '',
    row.warning ? h('span', { class: 'meta' }, chip('will not fill', 'danger'), ' ', row.warning) : null,
  );
}

/**
 * @param {HTMLElement} root
 * @param {ViewContext} ctx
 */
export function render(root, ctx) {
  const { snap } = ctx;
  const rows = snap.verifyRows ?? [];
  const prepared = snap.prepared;
  const withValue = rows.filter((r) => r.hasValue && !r.warning).length;
  const missingRequired = rows.filter((r) => !r.hasValue && !r.optional).length;
  const fragile = prepared ? prepared.fragileKeys : [];
  const widget = rows.filter((r) => r.entryMode === 'widget').length;

  /** @type {Map<string, VerifyRow[]>} */
  const bySection = new Map();
  for (const r of rows) {
    const list = bySection.get(r.section) ?? [];
    list.push(r);
    bySection.set(r.section, list);
  }

  replace(root,
    h('h2', { class: 'panel__title' }, 'Verify'),
    h('p', { class: 'panel__lede' }, snap.engagement ? snap.engagement.companyName : '', prepared ? ` · ${prepared.recipeLabel}` : ''),
    h('div', { class: 'diff__summary' },
      chip(`${withValue} of ${rows.length} fields have a value`, withValue === rows.length ? 'success' : 'primary'),
      missingRequired ? chip(`${missingRequired} required without value`, 'danger') : null,
      widget ? chip(`${widget} picked from a list`, 'plain') : null,
      prepared ? chip(`recipe v${prepared.recipeVersion} · map v${prepared.fieldMapVersion}`, 'plain') : null,
    ),
    prepared && prepared.warnings.length
      ? prepared.warnings.map((w) => h('div', { class: 'banner banner--waiting' }, h('strong', null, 'Version skew'), w))
      : null,
    fragile.length
      ? h('div', { class: 'banner banner--waiting' },
        h('strong', null, `${fragile.length} field${fragile.length === 1 ? ' has' : 's have'} a fragile selector`),
        'The map marks ', fragile.map((k, i) => [i ? ', ' : '', code(k)]), ' as likely to change. The run will stop and name the field if a selector misses.')
      : null,
    prepared && prepared.recipeId.endsWith('.example')
      ? h('div', { class: 'banner banner--primary' }, h('strong', null, 'Example stub'), 'Development mode is on and the ', code(prepared.recipeId), ' stub is loaded. Its selectors are placeholders and will not match the real portal.')
      : null,
    Array.from(bySection.entries()).map(([section, list]) => h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h3', null, `Section ${section}`), chip(`${list.length} field${list.length === 1 ? '' : 's'}`, 'plain')),
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Field'), h('th', null, 'Value'), h('th', null, 'Source'))),
          h('tbody', null, list.map((r) => h('tr', null,
            h('td', null, r.label, h('span', { class: 'meta' }, r.key, r.stability === 'fragile' ? ' · fragile' : '', r.entryMode === 'widget' ? ' · list' : '')),
            valueCell(r),
            h('td', null, code(r.sourceField)),
          ))),
        ),
      ),
    )),
    h('p', { class: 'muted' }, 'Edit is not offered here. Wrong data is fixed in VCFO Suite, then the engagement is loaded again.'),
  );
}

/**
 * @param {ViewContext} ctx
 * @returns {import('../context.js').PrimaryAction | null}
 */
export function primary(ctx) {
  const rows = ctx.snap.verifyRows ?? [];
  const fillable = rows.some((r) => r.hasValue && !r.warning);
  return {
    label: 'Fill the form',
    disabled: !fillable || !ctx.snap.prepared,
    onClick: async () => {
      const tab = await ctx.activeTabId();
      if (!tab.ok) {
        ctx.setError(tab.error);
        return;
      }
      const r = await ctx.request({ type: MSG.START_RUN, tabId: tab.value });
      if (!r.ok) {
        ctx.setError(r.error);
        return;
      }
      await ctx.refresh();
      ctx.goto('autofill');
    },
  };
}
