// Panel 3 — Autofill. Live step list ticking over as the run executes, the
// read-back diff on completion, human-gate and interrupted-step prompts, and
// the run log. Values appear only in mismatch rows.

import { MSG } from '../../shared/constants.js';
import { h, chip, code, icon, replace } from '../dom.js';

/** @typedef {import('../context.js').ViewContext} ViewContext */
/** @typedef {import('../../shared/schema.js').RunState} RunState */
/** @typedef {import('../../shared/schema.js').StepResult} StepResult */

/**
 * @param {RunState} run
 * @returns {HTMLElement}
 */
function statusBanner(run) {
  const total = run.steps.length;
  switch (run.status) {
    case 'running': {
      const current = run.inFlight ? run.inFlight.label : '';
      return h('div', { class: 'banner banner--primary' },
        h('strong', null, `Filling — step ${Math.min(run.stepIndex + 1, total)} of ${total}`),
        current ? h('span', null, current) : 'Waiting for the page.');
    }
    case 'paused':
      if (run.pause && run.pause.kind === 'humanGate') {
        return h('div', { class: 'banner banner--waiting' }, h('strong', null, 'Waiting on you'), run.pause.message);
      }
      if (run.pause && run.pause.kind === 'inFlight') {
        return h('div', { class: 'banner banner--waiting' }, h('strong', null, 'Interrupted step'), run.pause.message);
      }
      return h('div', { class: 'banner banner--waiting' }, h('strong', null, 'Paused'));
    case 'halted':
      return h('div', { class: 'banner banner--success' },
        h('strong', null, 'Filled and stopped'),
        run.haltReason ?? 'Review every field, then submit yourself.');
    case 'failed': {
      const e = run.error;
      return h('div', { class: 'banner banner--danger' },
        h('strong', null, `Stopped: ${e ? e.class : 'failure'}${e && e.step ? ` at "${e.step}"` : ''}`),
        h('div', null, e ? e.message : 'The run failed.'),
        e && e.selectors && e.selectors.length
          ? h('ul', { class: 'mono' }, e.selectors.map((s, i) => h('li', null, code(s), e.matchCounts && e.matchCounts[i] !== undefined ? ` — ${e.matchCounts[i] === -1 ? 'invalid' : `${e.matchCounts[i]} match${e.matchCounts[i] === 1 ? '' : 'es'}`}` : '')))
          : null,
        e && e.elapsedMs ? h('div', { class: 'meta' }, `after ${(e.elapsedMs / 1000).toFixed(1)}s`) : null,
      );
    }
    case 'aborted':
      return h('div', { class: 'banner' }, h('strong', null, 'Stopped by you'), 'Nothing further was filled.');
    default:
      return h('div', { class: 'banner' }, run.status);
  }
}

/**
 * @param {RunState} run
 * @returns {HTMLElement}
 */
function stepList(run) {
  /** @type {Map<number, StepResult>} */
  const results = new Map(run.stepResults.map((r) => [r.index, r]));
  return h('ol', { class: 'steps' }, run.steps.map((s) => {
    const r = results.get(s.index);
    const active = run.inFlight ? run.inFlight.index === s.index : (run.status === 'running' && run.stepIndex === s.index);
    let cls = 'step';
    /** @type {Node | null} */
    let mark = null;
    if (r && r.skipped) { cls += ' step--skipped'; mark = icon('arrow'); }
    else if (r && r.ok) { cls += ' step--done'; mark = icon('check'); }
    else if (r && !r.ok) { cls += ' step--failed'; mark = icon('x'); }
    else if (active) cls += ' step--active';
    else if (run.pause && run.pause.kind === 'inFlight' && run.pause.stepIndex === s.index) { cls += ' step--active'; }
    else cls += ' step--locked';
    return h('li', { class: cls },
      h('span', { class: 'step__dot' }, mark),
      h('div', { class: 'step__body' },
        h('div', { class: 'step__label' }, s.label),
        h('div', { class: 'step__meta meta' }, s.op, r ? ` · ${r.skipped ? 'continued past after restart' : `${r.ms} ms`}` : ''),
      ),
    );
  }));
}

/**
 * @param {RunState} run
 * @param {ViewContext} ctx
 * @returns {HTMLElement | null}
 */
function diffBlock(run, ctx) {
  const diff = run.diff;
  if (!diff) return null;
  const n = diff.mismatches.length;
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h3', null, 'Read-back')),
    h('div', { class: 'diff__summary' },
      chip(`${diff.matched} of ${diff.checked} verified`, diff.matched === diff.checked ? 'success' : 'primary'),
      n ? chip(`${n} mismatch${n === 1 ? '' : 'es'}`, 'danger') : chip('no mismatches', 'success'),
      diff.skipped.length ? chip(`${diff.skipped.length} skipped`, 'plain') : null,
    ),
    diff.mismatches.map((m) => h('div', { class: 'diff__row' },
      h('div', null, h('strong', null, m.label), ' ', code(m.key)),
      h('dl', { class: 'diff__kv' },
        h('dt', null, 'expected'), h('dd', null, m.expected === '' ? h('span', { class: 'muted' }, '(empty)') : m.expected),
        h('dt', null, 'on page'), h('dd', null, m.actual === '' ? h('span', { class: 'muted' }, '(empty)') : m.actual),
        h('dt', null, 'reason'), h('dd', null, m.reason),
      ),
    )),
    diff.skipped.length
      ? h('details', null, h('summary', { class: 'muted' }, `Skipped (${diff.skipped.length})`), h('ul', { class: 'mono' }, diff.skipped.map((s) => h('li', null, code(s.key), ` — ${s.reason}`))))
      : null,
    n && run.status === 'halted'
      ? h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', checked: run.mismatchOverride || undefined,
          onchange: async (/** @type {Event} */ e) => {
            const on = /** @type {HTMLInputElement} */ (e.target).checked;
            const r = await ctx.request({ type: MSG.OVERRIDE_MISMATCHES, confirmed: on });
            if (!r.ok) ctx.setError(r.error);
          },
        }),
        h('span', null, 'I have opened each mismatched field on the MCA form, corrected it by hand where needed, and want to continue to review.'),
      )
      : null,
  );
}

/**
 * @param {RunState} run
 * @param {ViewContext} ctx
 * @returns {HTMLElement | null}
 */
function pauseControls(run, ctx) {
  if (run.status !== 'paused' || !run.pause) return null;
  if (run.pause.kind === 'humanGate') {
    return h('div', { class: 'btn-row' },
      h('button', {
        type: 'button', class: 'btn btn--primary',
        onclick: async () => {
          const r = await ctx.request({ type: MSG.CONTINUE_GATE });
          if (!r.ok) ctx.setError(r.error);
        },
      }, 'I have done this — continue'),
    );
  }
  const ev = run.pause.evidence;
  /** @param {boolean | null} b */
  const yesNo = (b) => (b === null ? chip('unknown', 'plain') : (b ? chip('yes', 'success') : chip('no', 'danger')));
  const evidence = h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h3', null, 'What the page shows now')),
    h('dl', { class: 'kv' },
      h('dt', null, 'URL'), h('dd', null, ev.url || h('span', { class: 'muted' }, 'could not be read')),
      ev.target ? [h('dt', null, 'target'), h('dd', null, code(ev.target), ' ', yesNo(ev.targetFound), ' ', h('span', { class: 'muted' }, 'found'))] : null,
      ev.holdsExpected !== null ? [h('dt', null, 'field'), h('dd', null, yesNo(ev.holdsExpected), ' ', h('span', { class: 'muted' }, 'already holds its value'))] : null,
      ev.total !== null ? [h('dt', null, 'section'), h('dd', null, `${ev.matched ?? 0} of ${ev.total} fields already hold their value`)] : null,
    ),
    ev.note ? h('p', { class: 'muted' }, ev.note) : null,
  );
  return h('div', { class: 'stack' },
    evidence,
    h('div', { class: 'btn-row' },
      h('button', {
        type: 'button', class: 'btn btn--primary',
        onclick: async () => {
          const r = await ctx.request({ type: MSG.RESOLVE_IN_FLIGHT, action: 'continue' });
          if (!r.ok) ctx.setError(r.error);
        },
      }, 'It happened — continue'),
      h('button', {
        type: 'button', class: 'btn btn--ghost',
        onclick: async () => {
          const r = await ctx.request({ type: MSG.RESOLVE_IN_FLIGHT, action: 'retry' });
          if (!r.ok) ctx.setError(r.error);
        },
      }, 'It did not — retry the step'),
    ),
  );
}

/**
 * @param {RunState} run
 * @returns {HTMLElement}
 */
function logBlock(run) {
  return h('details', { class: 'log' },
    h('summary', null, `Run log (${run.log.length})`),
    h('ul', { class: 'log__list' }, run.log.slice(-120).map((l) => h('li', { class: l.outcome === 'ok' ? 'ok' : (l.outcome === 'error' ? 'error' : '') },
      `${l.at.slice(11, 19)} ${l.op} · ${l.label} · ${l.outcome}${l.ms ? ` · ${l.ms} ms` : ''}${l.note ? ` · ${l.note}` : ''}`,
    ))),
  );
}

/**
 * @param {HTMLElement} root
 * @param {ViewContext} ctx
 */
export function render(root, ctx) {
  const run = ctx.snap.run;
  if (!run) {
    replace(root, h('h2', { class: 'panel__title' }, 'Autofill'), h('p', { class: 'muted' }, 'No run yet. Go back to Verify and press "Fill the form".'));
    return;
  }
  replace(root,
    h('h2', { class: 'panel__title' }, 'Autofill'),
    h('p', { class: 'panel__lede' }, `${ctx.snap.prepared ? ctx.snap.prepared.recipeLabel : run.recipeId} · recipe v${run.recipeVersion} · map v${run.fieldMapVersion}`),
    statusBanner(run),
    pauseControls(run, ctx),
    h('div', { class: 'card' }, h('div', { class: 'card__head' }, h('h3', null, 'Steps'), chip(`${run.stepResults.filter((r) => r.ok).length}/${run.steps.length}`, 'plain')), stepList(run)),
    diffBlock(run, ctx),
    logBlock(run),
  );
}

/**
 * @param {ViewContext} ctx
 * @returns {import('../context.js').PrimaryAction | null}
 */
export function primary(ctx) {
  const run = ctx.snap.run;
  if (!run) {
    return { label: 'Back to Verify', disabled: false, onClick: () => ctx.goto('verify') };
  }
  if (run.status === 'failed' || run.status === 'aborted') {
    return {
      label: 'Back to Import',
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
  const mismatches = run.diff ? run.diff.mismatches.length : 0;
  const unresolved = mismatches > 0 && !run.mismatchOverride;
  return {
    label: 'Continue to review',
    disabled: run.status !== 'halted' || unresolved,
    onClick: () => ctx.goto('gate'),
  };
}
