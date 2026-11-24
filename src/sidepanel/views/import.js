// Panel 1 — Import. Suite origin, form picker, engagement picker (live,
// fixture or bundle). Shows the engagement name only; never a field value.

import { MSG } from '../../shared/constants.js';
import { h, chip, replace } from '../dom.js';
import { requestOriginPermission, normaliseOrigin, SUITE_ORIGIN_DEFAULTS } from '../../suite/client.js';

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
  /** Engagement found open in a Suite tab; undefined = not looked yet. */
  /** @type {{ engagementId: string, tabId: number, title: string } | null | undefined} */
  detected: undefined,
  detecting: false,
  startId: '',
  /** MCA tab waiting for the lead to log in; null when not at the gate. */
  /** @type {number | null} */
  gateTabId: null,
  /** Suite tab to offer after a sign-in failure. */
  /** @type {number | null} */
  suiteTabId: null,
};

/**
 * Bring a tab and its window to the front.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab && typeof tab.windowId === 'number') await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    // Closed meanwhile; nothing to focus.
  }
}

/**
 * @param {ViewContext} ctx
 * @returns {string}
 */
function currentFormId(ctx) {
  if (local.formId) return local.formId;
  const enabled = ctx.snap.forms.filter((f) => f.enabled);
  // A start from a Suite page (Ask VCFO, the reg-4 step) names the form.
  const asked = ctx.snap.pendingStart?.formId;
  if (asked && enabled.some((f) => f.id === asked)) {
    local.formId = asked;
    return asked;
  }
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
    local.detected = undefined;
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
    h('div', { class: 'btn-row' },
      SUITE_ORIGIN_DEFAULTS.map((o) => h('button', {
        type: 'button', class: 'btn btn--ghost btn--sm',
        onclick: () => { local.originInput = o; void save(); },
      }, `Use ${o}`)),
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
      locked ? h('span', { class: 'hint' }, 'Change the engagement to pick a different form.') : h('span', { class: 'hint' }, 'SPICe+ Part A, and GST REG-01 Part A then Part B. GST fills only the development mock until the CS opinion is in.'),
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

/* ------------------------------------------------------------------------ */
/* The one button                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Look for an engagement open in Suite once per panel lifetime (or on demand).
 * @param {ViewContext} ctx
 */
function detectOnce(ctx) {
  if (local.detected !== undefined || local.detecting || ctx.snap.suiteOrigin === '' || ctx.snap.engagement) return;
  local.detecting = true;
  void ctx.request({ type: MSG.DETECT_SUITE_ENGAGEMENT }).then(async (r) => {
    /** @type {{ engagementId: string, tabId: number, title: string } | null} */
    const found = r.ok ? /** @type {any} */ (r.value) : null;
    local.detected = found;
    // Confirm by the company name Suite returns, not the tab title (titles go
    // stale): load the profile for the open engagement straight away.
    if (found) await loadForStart(ctx, found.engagementId);
    local.detecting = false;
    ctx.rerender();
  });
}

/**
 * Load the Part A profile for an engagement so the panel can show Suite's
 * company name before Start. Read-only; nothing is opened on MCA yet.
 * @param {ViewContext} ctx
 * @param {string} engagementId
 * @returns {Promise<void>}
 */
async function loadForStart(ctx, engagementId) {
  ctx.setError(null);
  local.suiteTabId = null;
  ctx.setBusy(true);
  const r = await ctx.request({ type: MSG.LOAD_ENGAGEMENT, source: 'suite', formId: 'spice-part-a', engagementId });
  ctx.setBusy(false);
  if (!r.ok) {
    const tabId = r.error.details?.tabId;
    if (r.error.class === 'auth' && typeof tabId === 'number') local.suiteTabId = tabId;
    ctx.setError(r.error);
    return;
  }
  await ctx.refresh();
}

/**
 * Start SPICe+ Part A: load the profile, open MCA, wait at the login gate.
 * @param {ViewContext} ctx
 * @returns {Promise<void>}
 */
async function startPartA(ctx) {
  ctx.setError(null);
  local.suiteTabId = null;
  ctx.setBusy(true);
  // An engagement already loaded (and confirmed by name) is the one started.
  const typed = ctx.snap.engagement ? '' : local.startId.trim();
  const r = await ctx.request({ type: MSG.START_PART_A, engagementId: typed || undefined, formId: currentFormId(ctx) });
  ctx.setBusy(false);
  if (!r.ok) {
    const tabId = r.error.details?.tabId;
    if (r.error.class === 'auth' && typeof tabId === 'number') local.suiteTabId = tabId;
    ctx.setError(r.error);
    ctx.rerender();
    return;
  }
  local.gateTabId = /** @type {{ mcaTabId: number }} */ (r.value).mcaTabId;
  await ctx.refresh();
}

/**
 * The lead has logged in: run the Part A recipe on the MCA tab.
 * @param {ViewContext} ctx
 * @returns {Promise<void>}
 */
async function continueAfterLogin(ctx) {
  if (local.gateTabId === null) return;
  ctx.setError(null);
  ctx.setBusy(true);
  const r = await ctx.request({ type: MSG.START_RUN, tabId: local.gateTabId });
  ctx.setBusy(false);
  if (!r.ok) {
    ctx.setError(r.error);
    return;
  }
  local.gateTabId = null;
  await ctx.refresh();
  ctx.goto('autofill');
}

/**
 * @param {ViewContext} ctx
 * @returns {HTMLElement}
 */
function startCard(ctx) {
  const { snap } = ctx;
  const formId = currentFormId(ctx);
  const gst = formId.startsWith('gst-');
  const formLabel = snap.forms.find((f) => f.id === formId)?.label ?? formId;
  if (local.gateTabId !== null) {
    const tabId = local.gateTabId;
    return h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h3', null, gst ? 'Open the GST portal' : 'Log in to MCA'), chip('Waiting for you', 'waiting')),
      h('div', { class: 'stack' },
        h('p', null, gst && formId.endsWith('part-b')
          ? 'Log in with your TRN (TRN, email, captcha, OTP), open My Saved Applications, click Edit, then click Continue.'
          : gst ? 'The New Registration page is open. Click Continue.' : 'Log in, clear the captcha and OTP, then click Continue.'),
        h('p', { class: 'muted' }, `Assist never types a user id, password, TRN, captcha or OTP. After Continue it fills ${formLabel}; you review, sign and submit.`),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn--primary', onclick: () => { void continueAfterLogin(ctx); } }, 'Continue'),
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { void focusTab(tabId); } }, 'Show the portal tab'),
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { local.gateTabId = null; ctx.rerender(); } }, 'Cancel'),
        ),
      ),
    );
  }

  detectOnce(ctx);
  const fixture = snap.suiteOrigin === '';
  /** @type {{ engagementId: string, tabId: number, title: string } | null | undefined} */
  const found = local.detected;
  /** @type {HTMLElement} */
  let which;
  if (snap.engagement) {
    which = h('p', null, `Fill ${formLabel} for `, h('strong', null, snap.engagement.companyName), ', as named by VCFO Suite above.');
  } else if (fixture) {
    which = h('p', { class: 'muted' }, 'No Suite origin is set: the development fixture is used.');
  } else if (found && local.detecting) {
    which = h('p', { class: 'muted' }, `Loading ${found.engagementId} from VCFO Suite…`);
  } else {
    which = h('div', { class: 'stack stack--tight' },
      h('p', { class: 'muted' }, local.detecting
        ? 'Looking for an engagement open in VCFO Suite…'
        : found
          ? `${found.engagementId} could not be loaded (see the message above). Enter another id or slug, or fix it in Suite and look again.`
          : `No engagement is open in a ${snap.suiteOrigin} tab. Open it in VCFO Suite, or enter its id or slug.`),
      h('div', { class: 'field' },
        h('label', { for: 'start-id' }, 'Engagement id or slug'),
        h('input', {
          id: 'start-id', class: 'input input--mono', type: 'text', placeholder: 'acme-india-private-limited', value: local.startId,
          autocomplete: 'off', spellcheck: 'false',
          oninput: (/** @type {Event} */ e) => { local.startId = /** @type {HTMLInputElement} */ (e.target).value; },
          onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') void startPartA(ctx); },
        }),
      ),
    );
  }
  const suiteTab = local.suiteTabId;
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h3', null, formLabel)),
    h('div', { class: 'stack' },
      which,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => { void startPartA(ctx); } }, `Start ${formLabel.split(' — ')[0]}`),
        fixture ? null : h('button', {
          type: 'button', class: 'btn btn--ghost btn--sm',
          onclick: () => { local.detected = undefined; ctx.rerender(); },
        }, 'Look again'),
        suiteTab !== null ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { void focusTab(suiteTab); } }, 'Show the VCFO Suite tab') : null,
      ),
      h('p', { class: 'hint' }, 'Loads the engagement from Suite, opens the portal for you to log in, then opens the form and fills it. Nothing is submitted.'),
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
            local.gateTabId = null;
            local.detected = undefined;
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
    h('div', { class: 'card__head' }, h('h3', null, 'Another form, or no Suite access')),
    h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Load an engagement for the form chosen above, then Continue to check it before filling. Without access to Suite, import a bundle exported from it.'),
      tabs, local.mode === 'suite' ? picker : bundle),
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
    h('p', { class: 'panel__lede' }, 'One button for SPICe+ Part A. Assist reads the data; you log in and submit.'),
    sourceCard(ctx),
    ctx.snap.engagement ? engagementCard(ctx) : null,
    startCard(ctx),
    gapsCard(ctx),
    ctx.snap.engagement ? null : formCard(ctx),
    ctx.snap.engagement ? null : engagementCard(ctx),
  );
}

/**
 * @param {ViewContext} ctx
 * @returns {import('../context.js').PrimaryAction | null}
 */
export function primary(ctx) {
  if (local.gateTabId !== null) {
    return { label: 'Continue', disabled: false, onClick: () => continueAfterLogin(ctx) };
  }
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
