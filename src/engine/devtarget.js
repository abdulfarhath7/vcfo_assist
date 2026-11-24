// Development retargeting. A recipe and its field map name the real portal
// origin (https://reg.gst.gov.in). For the offline tests the same recipe must
// run against the local mock in fixtures/gst-portal, served on a loopback
// origin. This module is the only place that swaps one for the other, and it
// does so only when all three hold:
//
//   1. the build is unpacked (no `update_url` in the manifest: never a store build),
//   2. development mode is on (an unpacked-only preference),
//   3. `va.pref.mockOrigin` holds a loopback http origin.
//
// The real origin in the files never changes, and the guard still refuses any
// navigation that is neither a listed portal origin nor this loopback origin.

import { LOCAL_KEYS, NAVIGATE_ORIGINS, isLoopbackOrigin } from '../shared/constants.js';

/** @typedef {import('../shared/schema.js').Recipe} Recipe */
/** @typedef {import('../shared/schema.js').FieldMap} FieldMap */
/** @typedef {import('../shared/schema.js').ResultRecipe} ResultRecipe */

/** @returns {boolean} */
function isUnpacked() {
  try {
    return !('update_url' in chrome.runtime.getManifest());
  } catch {
    return false;
  }
}

/**
 * The mock origin to use, or '' when retargeting is off.
 * @param {boolean} devMode
 * @returns {Promise<string>}
 */
export async function mockOrigin(devMode) {
  if (!devMode || !isUnpacked()) return '';
  let v;
  try {
    const got = await chrome.storage.local.get(LOCAL_KEYS.MOCK_ORIGIN);
    v = got[LOCAL_KEYS.MOCK_ORIGIN];
  } catch {
    return '';
  }
  return typeof v === 'string' && isLoopbackOrigin(v) ? v : '';
}

/**
 * Replace a listed portal origin at the start of a URL with the mock origin.
 * @param {string} url
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function swap(url, from, to) {
  return url.startsWith(from) ? to + url.slice(from.length) : url;
}

/**
 * Retarget a recipe (and its navigate URLs) from its portal origin to the mock.
 * Returns the recipe unchanged when the mock origin is '' or the recipe's
 * origin is not a listed portal origin.
 * @param {Recipe} recipe
 * @param {string} mock
 * @returns {Recipe}
 */
export function retargetRecipe(recipe, mock) {
  if (!mock || !NAVIGATE_ORIGINS.includes(recipe.origin)) return recipe;
  const from = recipe.origin;
  /** @param {import('../shared/schema.js').Step} s @returns {import('../shared/schema.js').Step} */
  const step = (s) => ({
    ...s,
    ...(s.url ? { url: swap(s.url, from, mock) } : {}),
    ...(s.steps ? { steps: s.steps.map(step) } : {}),
  });
  return {
    ...recipe,
    origin: mock,
    preconditions: recipe.preconditions.map((p) => (p.pattern ? { ...p, pattern: p.pattern.split(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(mock) } : p)),
    steps: recipe.steps.map(step),
  };
}

/**
 * @param {FieldMap} fieldMap
 * @param {string} mock
 * @returns {FieldMap}
 */
export function retargetFieldMap(fieldMap, mock) {
  if (!mock || !NAVIGATE_ORIGINS.includes(fieldMap.origin)) return fieldMap;
  return { ...fieldMap, origin: mock };
}

/**
 * @param {ResultRecipe} rr
 * @param {string} mock
 * @returns {ResultRecipe}
 */
export function retargetResultRecipe(rr, mock) {
  if (!mock || !NAVIGATE_ORIGINS.includes(rr.origin)) return { ...rr };
  return { ...rr, origin: mock };
}
