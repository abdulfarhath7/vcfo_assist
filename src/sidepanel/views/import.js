// Panel 1 — Import. Suite origin, form picker, engagement picker (live,
// fixture or bundle). Shows the engagement name only; never a field value.

import { MSG } from '../../shared/constants.js';
import { h, chip, replace } from '../dom.js';
import { requestOriginPermission, normaliseOrigin } from '../../suite/client.js';

/** @typedef {import('../context.js').ViewContext} ViewContext */

/** Transient inputs that survive re-renders within one panel lifetime. */
const local = {
  editingOrigin: false,
  originInput: '',
  formId: '',
  engagementId: '',
  /** @type {string | null} */
  bundleText: null,
  bundleName: '',
  passphrase: '',
  mode: /** @type {'suite' | 'bundle'} */ ('suite'),
};

/**
 * @param {ViewContext} ctx
 * @returns {string}
 */
function currentFormId(ctx) {
  if (local.formId) return local.formId;
  const enabled = ctx.snap.forms.filter((f) => f.enabled);
  const last = ctx.snap.lastForm && enabled.some((f) => f.id === ctx.snap.lastForm) ? ctx.snap.lastForm : null;
  local.formId = last ?? (enabled[0] ? enabled[0].id : '');
  return local.formId;
}

/**
 * @param {import('../../shared/schema.js').EngagementSource | null} source
 * @returns {HTMLElement}
 */
function sourceChip(source) {
  if (source === 'suite') return chip('Live from VCFO Suite', 'success');
  if (source === 'bundle') return chip('Imported bundle', 'primary');
  return chip('Development fixture', 'waiting');
}

/* ------------------------------------------------------------------------ */
/* Source card                                                               */
/* ------------------------------------------------------------------------ */

/**
 * @param {ViewContext} ctx
 * @returns {HTMLElement}
 */
function sourceCard(ctx) {
  const { snap } = ctx;
  const hasOrigin = snap.suiteOrigin !== '';

  /** @returns {Promise<void>} */
  const save = async () => {
    const n = normaliseOrigin(local.originInput);
    if (!n.ok) {
      ctx.setError(n.error);
      return;
    }
    if (n.value !== '') {
      const granted = await requestOriginPermission(n.value);
      if (!granted) {
        ctx.setError(`Allow access to ${n.value} to load engagements. Assist only talks to a Suite origin you allow.`);
        return;
      }
    }
    ctx.setBusy(true);
    const r = await ctx.request({ type: MSG.SET_SUITE_ORIGIN, origin: n.value });
    ctx.setBusy(false);
    if (!r.ok) {
      ctx.setError(r.error);
      return;
    }
    local.editingOrigin = false;
    await ctx.refresh();
  };

  const editor = h('div', { class: 'stack stack--tight' },
    h('div', { class: 'field' },
      h('label', { for: 'origin' }, 'VCFO Suite origin'),
      h('div', { class: 'inline' },
        h('input', {
          id: 'origin', class: 'input input--mono', type: 'url', placeholder: 'https://suite.example.com',
          value: local.originInput, autocomplete: 'off', spellcheck: 'false',
          oninput: (/** @type {Event} */ e) => { local.originInput = /** @type {HTMLInputElement} */ (e.target).value; },
          onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') void save(); },
        }),
        h('button', { type: 'button', class: 'btn btn--sm', onclick: () => { void save(); } }, 'Save'),
      ),
      h('span', { class: 'hint' }, 'Leave empty to use the development fixture. Saving asks you to allow this origin, and only this origin.'),
    ),
    hasOrigin ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { local.editingOrigin = false; ctx.rerender(); } }, 'Cancel') : null,
  );

  const summary = h('div', { class: 'inline' },
    h('span', { class: 'mono' }, snap.suiteOrigin),
    h('button', {
      type: 'button', class: 'btn btn--ghost btn--sm',
      onclick: () => { local.editingOrigin = true; local.originInput = snap.suiteOrigin; ctx.rerender(); },
    }, 'Change'),
  );

  const fixtureNote = h('div', { class: 'stack stack--tight' },
    h('div', null, chip('Development fixture', 'waiting'), ' ', h('span', { class: 'muted' }, 'No Suite origin set — engagements come from ', h('code', null, 'fixtures/engagement.json'), '.')),
  );

  const devToggle = snap.unpacked
    ? h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: snap.devMode || undefined,
        onchange: async (/** @type {Event} */ e) => {
          const on = /** @type {HTMLInputElement} */ (e.target).checked;
          const r = await ctx.request({ type: MSG.SET_DEV_MODE, devMode: on });
          if (!r.ok) ctx.setError(r.error);
          await ctx.refresh();
        },
      }),
      h('span', null, 'Development mode ', h('span', { class: 'hint' }, '— allows the ', h('code', null, '.example'), ' recipe and field map stubs. Unpacked builds only.')),
    )
    : null;

  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h3', null, 'Source'), hasOrigin ? chip('Suite configured', 'success') : null),
    h('div', { class: 'stack' },
      hasOrigin && !local.editingOrigin ? summary : (hasOrigin ? editor : h('div', { class: 'stack' }, fixtureNote, editor)),
      devToggle,
    ),
  );
}

/* ------------------------------------------------------------------------ */
/* Form card                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * @param {ViewContext} ctx
 * @returns {HTMLElement}
 */
function formCard(ctx) {
  const current = currentFormId(ctx);
  const locked = ctx.snap.engagement !== null;
  const select = h('select', {
    class: 'input', id: 'form', disabled: locked || undefined,
    onchange: (/** @type {Event} */ e) => {
      local.formId = /** @type {HTMLSelectElement} */ (e.target).value;
      ctx.rerender();
    },
  }, ctx.snap.forms.map((f) => h('option', { value: f.id, disabled: !f.enabled || undefined, selected: f.id === current || undefined }, f.enabled ? f.label : `${f.label} (not yet available)`)));
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h3', null, 'Form')),
    h('div', { class: 'field' },
      h('label', { for: 'form' }, 'Which form to fill'),
      select,
      locked ? h('span', { class: 'hint' }, 'Change the engagement to pick a different form.') : h('span', { class: 'hint' }, 'Only SPICe+ Part A is enabled in this build.'),
    ),
  );
}

/* ------------------------------------------------------------------------ */
/* Engagement card                                                           */
/* ------------------------------------------------------------------------ */

/**
 * "Director 2 · PAN — Suite step pre-15, directors", or with Suite's reason.
 * @param {import('../../shared/schema.js').SuiteMissing} m
 * @returns {HTMLElement}
 */
function missingRow(m) {
  const label = m.directorIndex !== undefined ? `Director ${m.directorIndex} · ${m.label}` : m.label;
  const where = `Suite step ${m.stepId}${m.tabId ? `, ${m.tabId}` : ''}`;
  return h('li', null,
    h('strong', null, label),
    h('div', { class: 'meta' }, m.reason ? `${m.reason} — ${where}` : `Blank in ${where}`),
  );
}

/**
 * Suite's missing and notes lists, always open. A lead who cannot see what is
 * missing will assume the form is complete.
 * @param {ViewContext} ctx
 * @returns {HTMLElement | null}
 */
function gapsCard(ctx) {
  const { missing, notes } = ctx.snap;
  if (!ctx.snap.engagement || ctx.snap.engagementSource === null) return null;
  const blank = missing.filter((m) => !m.reason);
  const unsupplied = missing.filter((m) => m.reason);
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' },
      h('h3', null, 'What VCFO Suite could not supply'),
      blank.length ? chip(`${blank.length} blank in Suite`, 'waiting') : chip('Nothing blank in Suite', 'success'),
    ),
    h('div', { class: 'stack' },
      blank.length
        ? h('div', { class: 'stack stack--tight' },
          h('p', { class: 'muted' }, 'Blank in Suite — fill these in Suite and load again, or type them on the portal:'),
          h('ul', { class: 'gaps' }, blank.map(missingRow)))
        : null,
      unsupplied.length
        ? h('div', { class: 'stack stack--tight' },
          h('p', { class: 'muted' }, 'Suite cannot supply these — they stay empty and are yours to fill on the portal:'),
          h('ul', { class: 'gaps' }, unsupplied.map(missingRow)))
        : null,
      notes.length
        ? h('div', { class: 'stack stack--tight' },
          h('p', { class: 'muted' }, 'Notes from Suite:'),
          h('ul', { class: 'gaps' }, notes.map((n) => h('li', null, n.note, h('div', { class: 'meta' }, n.key)))))
        : null,
      !missing.length && !notes.length ? h('p', { class: 'muted' }, 'Suite reported nothing missing and no notes.') : null,
    ),
  );
}

/**
 * @param {ViewContext} ctx
 * @returns {HTMLElement}
 */
function engagementCard(ctx) {
  const { snap } = ctx;
  if (snap.engagement) {
    return h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h3', null, 'Engagement'), sourceChip(snap.engagementSource)),
      h('h1', null, snap.engagement.companyName),
      h('div', { class: 'meta' }, snap.engagement.stage ? `${snap.engagement.id} · ${snap.engagement.stage}` : snap.engagement.id),
      h('div', { class: 'btn-row' },
        h('button', {
          type: 'button', class: 'btn btn--ghost btn--sm',
          onclick: async () => {
            ctx.setBusy(true);
            const r = await ctx.request({ type: MSG.RESET });
            ctx.setBusy(false);
            if (!r.ok) ctx.setError(r.error);
            await ctx.refresh();
          },
        }, 'Change engagement'),
      ),
    );
  }

  const formId = currentFormId(ctx);
  const fixture = snap.suiteOrigin === '';

  /** @returns {Promise<void>} */
  const load = async () => {
    const id = local.engagementId.trim();
    if (!fixture && !id) {
      ctx.setError('Enter the engagement id or slug from VCFO Suite.');
      return;
    }
    ctx.setError(null);
    ctx.setBusy(true);
    const r = await ctx.request({ type: MSG.LOAD_ENGAGEMENT, source: fixture ? 'fixture' : 'suite', formId, engagementId: id || undefined });
    ctx.setBusy(false);
    if (!r.ok) {
      ctx.setError(r.error);
      return;
    }
    await ctx.refresh();
  };

  /** @returns {Promise<void>} */
  const importBundle = async () => {
    if (local.bundleText === null) {
      ctx.setError('Choose a .vcfoa bundle file first.');
      return;
    }
    ctx.setError(null);
    ctx.setBusy(true);
    const r = await ctx.request({ type: MSG.LOAD_ENGAGEMENT, source: 'bundle', formId, envelope: local.bundleText, passphrase: local.passphrase });
    // The file contents and passphrase are discarded whatever the outcome.
    local.bundleText = null;
    local.bundleName = '';
    local.passphrase = '';
    ctx.setBusy(false);
    if (!r.ok) {
      ctx.setError(r.error);
      ctx.rerender();
      return;
    }
    await ctx.refresh();
  };

  const picker = fixture
    ? h('div', { class: 'stack stack--tight' },
      h('p', { class: 'muted' }, 'No Suite origin is set, so the development fixture is used.'),
      h('button', { type: 'button', class: 'btn', onclick: () => { void load(); } }, 'Load fixture engagement'),
    )
    : h('div', { class: 'stack stack--tight' },
      h('p', { class: 'muted' }, `Read from ${snap.suiteOrigin} with your VCFO Suite session in this browser.`),
      h('div', { class: 'field' },
        h('label', { for: 'eng-id' }, 'Engagement id or slug'),
        h('input', {
          id: 'eng-id', class: 'input input--mono', type: 'text', placeholder: 'acme-india-private-limited', value: local.engagementId,
          autocomplete: 'off', spellcheck: 'false',
          oninput: (/** @type {Event} */ e) => { local.engagementId = /** @type {HTMLInputElement} */ (e.target).value; },
          onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') void load(); },
        }),
        h('span', { class: 'hint' }, 'As in the engagement\'s Suite URL.'),
      ),
      h('button', { type: 'button', class: 'btn', onclick: () => { void load(); } }, 'Load'),
    );

  const bundle = h('div', { class: 'stack stack--tight' },
    h('div', { class: 'field' },
      h('label', { for: 'bundle' }, '.vcfoa bundle'),
      h('input', {
        id: 'bundle', class: 'input', type: 'file', accept: '.vcfoa,application/json',
        onchange: (/** @type {Event} */ e) => {
          const input = /** @type {HTMLInputElement} */ (e.target);
          const file = input.files && input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            local.bundleText = typeof reader.result === 'string' ? reader.result : null;
            local.bundleName = file.name;
            input.value = '';
            ctx.rerender();
          };
          reader.onerror = () => ctx.setError(`Could not read ${file.name}.`);
          reader.readAsText(file);
        },
      }),
      local.bundleName ? h('span', { class: 'hint' }, `Selected: ${local.bundleName} (held in memory only)`) : h('span', { class: 'hint' }, 'Exported from VCFO Suite for a machine that cannot reach it. Never written to disk by Assist.'),
    ),
    h('div', { class: 'field' },
      h('label', { for: 'passphrase' }, 'Passphrase'),
      h('input', {
        id: 'passphrase', class: 'input input--mono', type: 'password', autocomplete: 'off', value: local.passphrase,
        oninput: (/** @type {Event} */ e) => { local.passphrase = /** @type {HTMLInputElement} */ (e.target).value; },
        onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') void importBundle(); },
      }),
      h('span', { class: 'hint' }, 'Shown once in Suite when the bundle was exported.'),
    ),
    h('button', { type: 'button', class: 'btn', onclick: () => { void importBundle(); } }, 'Import bundle'),
  );

  const tabs = h('div', { class: 'radio-list' },
    h('label', null, h('input', { type: 'radio', name: 'mode', checked: local.mode === 'suite' || undefined, onchange: () => { local.mode = 'suite'; ctx.rerender(); } }), fixture ? 'Development fixture' : 'Load from VCFO Suite'),
    h('label', null, h('input', { type: 'radio', name: 'mode', checked: local.mode === 'bundle' || undefined, onchange: () => { local.mode = 'bundle'; ctx.rerender(); } }), 'Imported bundle (.vcfoa)'),
  );

  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h3', null, 'Engagement')),
    h('div', { class: 'stack' }, tabs, local.mode === 'suite' ? picker : bundle),
  );
}

/* ------------------------------------------------------------------------ */
/* View                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * @param {HTMLElement} root
 * @param {ViewContext} ctx
 */
export function render(root, ctx) {
  replace(root,
    h('h2', { class: 'panel__title' }, 'Import'),
    h('p', { class: 'panel__lede' }, 'Pick the engagement and the form. Assist reads the data; you stay in control of the portal.'),
    sourceCard(ctx),
    formCard(ctx),
    engagementCard(ctx),
    gapsCard(ctx),
  );
}

/**
 * @param {ViewContext} ctx
 * @returns {import('../context.js').PrimaryAction | null}
 */
export function primary(ctx) {
  const formId = currentFormId(ctx);
  const ready = ctx.snap.engagement !== null && formId !== '';
  return {
    label: 'Continue',
    disabled: !ready,
    onClick: async () => {
      const r = await ctx.request({ type: MSG.PREPARE_FORM, formId });
      if (!r.ok) {
        ctx.setError(r.error);
        return;
      }
      await ctx.refresh();
      ctx.goto('verify');
    },
  };
}
