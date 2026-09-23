// Ok/Err result helper. Every fallible function in VCFO Assist returns a Result
// instead of throwing, so failures carry a class, a field key and the selectors
// tried — never a bare "something went wrong".

/**
 * @template T
 * @typedef {{ ok: true, value: T }} OkResult
 */

/**
 * @typedef {{ ok: false, error: import('./schema.js').AssistError }} ErrResult
 */

/**
 * @template T
 * @typedef {OkResult<T> | ErrResult} Result
 */

/**
 * Wrap a successful value.
 * @template T
 * @param {T} value
 * @returns {OkResult<T>}
 */
export function Ok(value) {
  return { ok: true, value };
}

/**
 * Build a failure. `message` must name the field key and selector where one
 * exists; it must never contain an engagement value.
 * @param {import('./schema.js').ErrorClass} errorClass
 * @param {string} message
 * @param {Partial<Omit<import('./schema.js').AssistError, 'class' | 'message'>>} [extra]
 * @returns {ErrResult}
 */
export function Err(errorClass, message, extra) {
  /** @type {import('./schema.js').AssistError} */
  const error = { class: errorClass, message, ...(extra ?? {}) };
  return { ok: false, error };
}

/**
 * Re-wrap an existing AssistError as a failed Result.
 * @param {import('./schema.js').AssistError} error
 * @returns {ErrResult}
 */
export function fromError(error) {
  return { ok: false, error };
}

/**
 * Narrowing helper.
 * @template T
 * @param {Result<T>} r
 * @returns {r is OkResult<T>}
 */
export function isOk(r) {
  return r.ok === true;
}

/**
 * Convert a thrown value into an AssistError of the given class. Thrown values
 * are never trusted to be Error instances.
 * @param {import('./schema.js').ErrorClass} errorClass
 * @param {unknown} thrown
 * @param {string} [context]
 * @returns {ErrResult}
 */
export function fromThrown(errorClass, thrown, context) {
  const text = thrown instanceof Error ? thrown.message : String(thrown);
  return Err(errorClass, context ? `${context}: ${text}` : text);
}
