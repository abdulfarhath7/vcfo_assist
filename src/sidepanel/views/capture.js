// Panel 5 — Capture and return. Read the SRN from the page per the result
// recipe, preview exactly what will be sent to Suite, send it, then offer a
// reset. Completion is a teal state, no celebration.

import { MSG } from '../../shared/constants.js';
import { h, chip, icon, replace, when } from '../dom.js';

/** @typedef {import('../context.js').ViewContext} ViewContext */
/** @typedef {import('../../shared/schema.js').CapturedResult} CapturedResult */

/**
 * @param {CapturedResult} captured
 * @returns {HTMLElement}
 */
function preview(captured) {
  const r = captured.result;
  return h('dl', { class: 'kv' },
    h('dt', null, 'engagement'), h('dd', null, captured.engagementId),
    h('dt', null, 'form'), h('dd', null, r.form),
    h('dt', null, 'srn'), h('dd', null, r.srn),
    h('dt', null, 'status'), h('dd', null, r.status),
    h('dt', null, 'capturedAt'), h('dd', null, r.capturedAt),
    h('dt', null, 'fieldsWritten'), h('dd', null, String(r.fieldsWritten)),
    h('dt', null, 'mismatches'), h('dd', null, r.mismatches.length ? r.mismatches.map((m) => m.key).join(', ') : 'none'),
    h('dt', null, 'versions'), h('dd', null, `recipe ${r.recipeVersion} · map ${r.fieldMapVersion}`),
  );
}

/**
 * @param {HTMLElement} root
 * @param {ViewContext} ctx
 */
export function render(root, ctx) {
  const { snap } = ctx;
  const captured = snap.captured;
  const fixture = snap.suiteOrigin === '' || snap.engagementSource === 'fixture';

  if (captured && captured.posted) {
    replace(root,
      h('h2', { class: 'panel__title' }, 'Capture and return'),
      h('div', { class: 'complete' },
        h('div', { class: 'complete__icon' }, icon('check')),
        h('h1', null, 'Sent to VCFO Suite'),
        h('p', { class: 'muted' }, `SRN ${captured.result.srn} · ${when(captured.postedAt)}`),
      ),
      h('div', { class: 'card' }, preview(captured)),
      h('p', { class: 'muted' }, 'The engagement data has been cleared from this browser session.'),
    );
    return;
  }

  /** @returns {Promise<void>} */
  const read = async () => {
    ctx.setError(null);
    const tab = await ctx.activeTabId();
    if (!tab.ok) {
      ctx.setError(tab.error);
      return;
    }
    ctx.setBusy(true);
    const r = await ctx.request({ type: MSG.CAPTURE_RESULT, tabId: tab.value });
    ctx.setBusy(false);
    if (!r.ok) {
      ctx.setError(r.error);
      return;
    }
    await ctx.refresh();
  };

  replace(root,
    h('h2', { class: 'panel__title' }, 'Capture and return'),
    h('p', { class: 'panel__lede' }, 'Read the SRN from the acknowledgement page and send the result back to VCFO Suite.'),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h3', null, 'Read the result'), captured ? chip('captured', 'success') : chip('not yet read', 'waiting')),
      h('p', { class: 'muted' }, 'Keep the MCA page that shows the SRN active beside this panel.'),
      h('button', { type: 'button', class: 'btn', onclick: () => { void read(); } }, captured ? 'Read SRN again' : 'Read SRN from page'),
    ),
    captured
      ? h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h3', null, 'What will be sent')),
        preview(captured),
        fixture
          ? h('div', { class: 'banner banner--waiting' }, h('strong', null, 'No Suite origin'), 'The development fixture is in use, so there is nowhere to send this. Set the Suite origin in Import to enable sending.')
          : h('p', { class: 'muted' }, `Posts to ${snap.suiteOrigin}. Sending again with the same SRN updates the record; it never duplicates.`),
      )
      : null,
    fixture && captured
      ? h('div', { class: 'btn-row' }, h('button', {
        type: 'button', class: 'btn',
        onclick: async () => {
          const r = await ctx.request({ type: MSG.RESET });
          if (!r.ok) ctx.setError(r.error);
          await ctx.refresh();
          ctx.goto('import');
        },
      }, 'Finish without sending'))
      : null,
  );
}

/**
 * @param {ViewContext} ctx
 * @returns {import('../context.js').PrimaryAction | null}
 */
export function primary(ctx) {
  const captured = ctx.snap.captured;
  if (captured && captured.posted) {
    return {
      label: 'Start another form',
      disabled: false,
      onClick: async () => {
        const r = await ctx.request({ type: MSG.RESET });
        if (!r.ok) {
          ctx.setError(r.error);
          return;
        }
        await ctx.refresh();
        ctx.goto('import');
      },
    };
  }
  const fixture = ctx.snap.suiteOrigin === '' || ctx.snap.engagementSource === 'fixture';
  return {
    label: 'Send to VCFO Suite',
    disabled: !captured || fixture,
    onClick: async () => {
      const r = await ctx.request({ type: MSG.POST_RESULT });
      if (!r.ok) {
        ctx.setError(r.error);
        return;
      }
      await ctx.refresh();
    },
  };
}
