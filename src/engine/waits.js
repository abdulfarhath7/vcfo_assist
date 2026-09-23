// Sliced waiting. A long wait is sent to the content script in slices so the
// worker's idle timer keeps resetting and an abort is honoured between
// slices. The worker owns the total timeout.

import { Ok, Err } from '../shared/result.js';
import { TIMEOUTS } from '../shared/constants.js';

/** @typedef {import('./context.js').OpContext} OpContext */
/** @typedef {import('../shared/schema.js').ContentOp} ContentOp */

/**
 * @param {OpContext} ctx
 * @param {ContentOp} op
 * @param {Record<string, unknown>} args    Without timeoutMs; added per slice
 * @param {number} totalMs
 * @param {(value: unknown) => boolean} isDone
 * @param {() => import('../shared/result.js').ErrResult} onTimeout
 * @returns {Promise<import('../shared/result.js').Result<unknown>>}
 */
export async function slicedWait(ctx, op, args, totalMs, isDone, onTimeout) {
  let elapsed = 0;
  /** @type {unknown} */
  let last = null;
  while (elapsed < totalMs) {
    if (ctx.abortRequested()) return Err('internal', 'aborted');
    const slice = Math.min(TIMEOUTS.WAIT_SLICE_MS, totalMs - elapsed);
    const started = Date.now();
    const r = await ctx.send(op, { ...args, timeoutMs: slice }, slice + TIMEOUTS.SLICE_MARGIN_MS);
    if (!r.ok) return r;
    last = r.value;
    if (isDone(r.value)) return Ok(r.value);
    elapsed += Math.max(slice, Date.now() - started);
  }
  const timeout = onTimeout();
  timeout.error.elapsedMs = elapsed;
  timeout.error.details = { ...(timeout.error.details ?? {}), lastUrl: lastUrl(last) };
  return timeout;
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function lastUrl(v) {
  if (typeof v === 'object' && v !== null && typeof (/** @type {{ url?: unknown }} */ (v)).url === 'string') {
    return /** @type {{ url: string }} */ (v).url;
  }
  return '';
}

/**
 * @param {unknown} v
 * @param {string} key
 * @returns {boolean}
 */
export function flag(v, key) {
  return typeof v === 'object' && v !== null && (/** @type {Record<string, unknown>} */ (v))[key] === true;
}
