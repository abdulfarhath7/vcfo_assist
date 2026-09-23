// Helpers over the Selectors shape shared by the worker, engine and panel.
// Content scripts cannot import this module; resolve.js and bridge.js carry
// their own copies of the label format.

/** @typedef {import('./schema.js').Selectors} Selectors */

/**
 * @param {Selectors} selectors
 * @returns {boolean}
 */
export function isGuideFieldNode(selectors) {
  return selectors.strategy === 'guideFieldNode';
}

/**
 * Human-readable name of what a Selectors object points at, for messages.
 * @param {Selectors} selectors
 * @returns {string}
 */
export function selectorsLabel(selectors) {
  if (isGuideFieldNode(selectors)) return `guideFieldNode "${selectors.key ?? ''}" #${(selectors.instance ?? 0) + 1}`;
  return selectors.primary;
}

/**
 * Every string a Selectors object matches on, for the credential check.
 * @param {Selectors} selectors
 * @returns {string[]}
 */
export function selectorStrings(selectors) {
  if (isGuideFieldNode(selectors)) return [selectors.key ?? ''];
  return [selectors.primary, ...selectors.fallbacks];
}
