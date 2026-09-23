// Wait primitives for the content script (classic script, isolated world).
// Installs `window.__VA.observe`. Each wait is bounded by the timeout the
// worker passes; the worker slices long waits so its own idle timer keeps
// resetting.

(() => {
  'use strict';

  /** @type {import('../../shared/schema.js').VAGlobal} */
  const VA = (/** @type {any} */ (window)).__VA ??= {};

  /** @typedef {import('../../shared/schema.js').Selectors} Selectors */

  const POLL_MS = 150;

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Poll `check` on an interval and on every DOM mutation until it returns
   * true or the timeout elapses.
   * @param {() => boolean} check
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  function until(check, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      /** @type {MutationObserver | null} */
      let observer = null;
      /** @type {ReturnType<typeof setInterval> | null} */
      let interval = null;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timer = null;
      /** @param {boolean} value */
      const finish = (value) => {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        if (interval !== null) clearInterval(interval);
        if (timer !== null) clearTimeout(timer);
        resolve(value);
      };
      /** @returns {void} */
      const tick = () => {
        let hit = false;
        try {
          hit = check();
        } catch {
          hit = false;
        }
        if (hit) finish(true);
      };
      tick();
      if (done) return;
      observer = new MutationObserver(tick);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      interval = setInterval(tick, POLL_MS);
      timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    });
  }

  /**
   * Resolve true once at least one visible element matches any candidate.
   * @param {Selectors} selectors
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  function waitFor(selectors, timeoutMs) {
    const resolveApi = VA.resolve;
    if (!resolveApi) return Promise.resolve(false);
    return until(() => resolveApi.countAll(selectors).some((c) => c > 0), timeoutMs);
  }

  /**
   * Resolve true once no visible element matches the selector.
   * @param {string} selector
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  function waitForGone(selector, timeoutMs) {
    const resolveApi = VA.resolve;
    if (!resolveApi) return Promise.resolve(false);
    return until(() => resolveApi.queryAll(selector).filter(resolveApi.isVisible).length === 0, timeoutMs);
  }

  /**
   * Resolve once the page URL matches the pattern. Also returns the URL seen
   * last so the worker can name it in a timeout message.
   * @param {string} pattern  RegExp source
   * @param {number} timeoutMs
   * @returns {Promise<{ matched: boolean, url: string }>}
   */
  async function waitForUrl(pattern, timeoutMs) {
    const re = new RegExp(pattern);
    const matched = await until(() => re.test(location.href), timeoutMs);
    return { matched, url: location.href };
  }

  /**
   * Resolve true once the DOM has been quiet for `quietMs`, or false when
   * `maxMs` elapses first. Used after dependency changes when the map
   * declares no loadingSelector.
   * @param {number} quietMs
   * @param {number} maxMs
   * @returns {Promise<boolean>}
   */
  function settle(quietMs, maxMs) {
    return new Promise((resolve) => {
      let done = false;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let quietTimer = null;
      const observer = new MutationObserver(() => {
        if (quietTimer !== null) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(true), quietMs);
      });
      /** @param {boolean} value */
      const finish = (value) => {
        if (done) return;
        done = true;
        observer.disconnect();
        if (quietTimer !== null) clearTimeout(quietTimer);
        clearTimeout(maxTimer);
        resolve(value);
      };
      const maxTimer = setTimeout(() => finish(false), Math.max(quietMs, maxMs));
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      quietTimer = setTimeout(() => finish(true), quietMs);
    });
  }

  VA.observe = { waitFor, waitForGone, waitForUrl, settle, sleep };
})();
