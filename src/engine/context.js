// The context every op receives. Built by the runner; ops never touch
// chrome.* directly, so the transport, persistence and logging rules live in
// one place.

import { toText, applyTransforms } from './transform.js';

/** @typedef {import('../shared/schema.js').Recipe} Recipe */
/** @typedef {import('../shared/schema.js').FieldMap} FieldMap */
/** @typedef {import('../shared/schema.js').FieldDef} FieldDef */
/** @typedef {import('../shared/schema.js').SuitePayload} SuitePayload */
/** @typedef {import('../shared/schema.js').RunState} RunState */
/** @typedef {import('../shared/schema.js').LogEntry} LogEntry */
/** @typedef {import('../shared/schema.js').PauseReason} PauseReason */
/** @typedef {import('../shared/schema.js').ContentOp} ContentOp */

/**
 * Outcome of looking a field's value up in the payload and transforming it.
 * @typedef {{ status: 'value', value: string }
 *   | { status: 'missing' }
 *   | { status: 'tooLong', value: string, maxLength: number }
 *   | { status: 'error', message: string }} ValueLookup
 */

/**
 * What an op reports back to the runner besides success.
 * @typedef {object} OpOutcome
 * @property {PauseReason} [pause]  humanGate: pause the run
 * @property {string} [halt]        halt: end the run cleanly
 * @property {string} [note]        short outcome note for the log; never a value
 */

/**
 * @typedef {object} OpContext
 * @property {string} runId
 * @property {number} tabId
 * @property {Recipe} recipe
 * @property {FieldMap} fieldMap
 * @property {SuitePayload} payload
 * @property {RunState} state
 * @property {(op: ContentOp, args: Record<string, unknown>, timeoutMs?: number) => Promise<import('../shared/result.js').Result<unknown>>} send
 * @property {(marker: string, shadowPath: string[]) => Promise<import('../shared/result.js').Result<{ triggered: boolean }>>} triggerJquery
 * @property {(entry: Omit<LogEntry, 'at'>) => void} log
 * @property {() => Promise<void>} persist
 * @property {() => boolean} abortRequested
 * @property {(field: FieldDef) => ValueLookup} valueFor
 */

/**
 * Look a field's value up in the payload and apply its transforms. Pure, so
 * panel 2 (verify) and the fill op show and type the same thing.
 * @param {FieldDef} field
 * @param {SuitePayload} payload
 * @returns {ValueLookup}
 */
export function lookupValue(field, payload) {
  const text = toText(payload.fields[field.sourceField]);
  if (text === null) return { status: 'missing' };
  const transformed = applyTransforms(field.transform, text);
  if (!transformed.ok) return { status: 'error', message: transformed.error.message };
  if (field.maxLength !== null && transformed.value.length > field.maxLength) {
    return { status: 'tooLong', value: transformed.value, maxLength: field.maxLength };
  }
  return { status: 'value', value: transformed.value };
}

/**
 * Wrap a selector string from a recipe step as a Selectors object so the
 * content script has one resolution path.
 * @param {string} selector
 * @returns {import('../shared/schema.js').Selectors}
 */
export function selectorsFor(selector) {
  return { primary: selector, fallbacks: [], shadowPath: [], stability: 'stable' };
}
