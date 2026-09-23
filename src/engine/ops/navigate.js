// navigate: load a URL in the run's tab, wait for it to finish loading, and
// re-establish the content-script bridge (the old document's bridge died with
// it). Only https://www.mca.gov.in is reachable: the loader refuses any other
// origin in a recipe, and the guard refuses it again here.

import { Ok, Err } from '../../shared/result.js';
import { TIMEOUTS } from '../../shared/constants.js';
import { checkNavigateTarget } from '../guard.js';
import { navigateTab, ensureBridge } from '../transport.js';

/** @typedef {import('../context.js').OpContext} OpContext */
/** @typedef {import('../../shared/schema.js').Step} Step */

/**
 * @param {OpContext} ctx
 * @param {Step} step
 * @returns {Promise<import('../../shared/result.js').Result<import('../context.js').OpOutcome>>}
 */
export async function run(ctx, step) {
  if (!step.url) return Err('validation', `navigate step "${step.label ?? ''}" has no url`);
  const allowed = checkNavigateTarget(step.url, step.label ?? '');
  if (!allowed.ok) return allowed;
  const loaded = await navigateTab(ctx.tabId, step.url, step.timeoutMs ?? TIMEOUTS.TAB_SETTLE_MS);
  if (!loaded.ok) return loaded;
  const bridge = await ensureBridge(ctx.tabId, ctx.runId);
  if (!bridge.ok) return bridge;
  return Ok({ note: `loaded ${new URL(step.url).pathname}` });
}
