// Panel 4 — Sign, pay, file. The human gate. A checklist of what the lead
// does now, a plain statement that Assist will not do these, and one control:
// "I have submitted". Nothing here can be mistaken for "submit for me".

import { MSG } from '../../shared/constants.js';
import { h, replace } from '../dom.js';

/** @typedef {import('../context.js').ViewContext} ViewContext */

const STEPS = Object.freeze([
  ['Review every field', 'Read the MCA form against the Verify table. Fix anything Assist got wrong or could not fill, directly on the portal.'],
  ['Affix your DSC', 'Attach the digital signature with your own token. Assist never signs.'],
  ['Pay the fee', 'Complete payment on the portal. Assist never pays.'],
  ['Submit the form', 'Press the portal’s own submit and complete any OTP or captcha it asks for. Assist never submits.'],
  ['Note the SRN', 'Leave the acknowledgement page open so it can be read back in the next step.'],
]);

/**
 * @param {HTMLElement} root
 * @param {ViewContext} ctx
 */
export function render(root, ctx) {
  const run = ctx.snap.run;
  replace(root,
    h('h2', { class: 'panel__title' }, 'Sign, pay, file'),
    h('p', { class: 'panel__lede' }, 'From here the filing and its certification are yours.'),
    h('div', { class: 'banner banner--waiting' },
      h('strong', null, 'VCFO Assist will not do these'),
      'Login, captcha, OTP, DSC signing, payment and final submission stay with you — permanently, not as a missing feature.'),
    run && run.diff && run.diff.mismatches.length
      ? h('div', { class: 'banner banner--danger' }, h('strong', null, `${run.diff.mismatches.length} field${run.diff.mismatches.length === 1 ? '' : 's'} did not verify`), 'You accepted these on the Autofill panel. Check each one on the form before you sign.')
      : null,
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h3', null, 'In your own hands')),
      h('ol', { class: 'checklist' }, STEPS.map(([title, detail], i) => h('li', null,
        h('span', { class: 'num' }, String(i + 1)),
        h('div', null, h('div', null, h('strong', null, title)), h('div', { class: 'muted' }, detail)),
      ))),
    ),
    h('p', { class: 'muted' }, 'When the portal has accepted the filing, press "I have submitted" below. That records your action; it does not submit anything.'),
  );
}

/**
 * @param {ViewContext} ctx
 * @returns {import('../context.js').PrimaryAction | null}
 */
export function primary(ctx) {
  const run = ctx.snap.run;
  return {
    label: 'I have submitted',
    disabled: !run || run.status !== 'halted',
    onClick: async () => {
      const r = await ctx.request({ type: MSG.MARK_SUBMITTED });
      if (!r.ok) {
        ctx.setError(r.error);
        return;
      }
      await ctx.refresh();
      ctx.goto('capture');
    },
  };
}
