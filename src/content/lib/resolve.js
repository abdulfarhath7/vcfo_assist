// Selector resolution for the content script (classic script, isolated
// world). Installs `window.__VA.resolve`. Knows nothing about MCA: every
// selector arrives from the worker inside an op message.
//
// Rule: exactly one visible match, or a failure that names every selector
// tried and its match count. Never the first of several.

(() => {
  'use strict';

  /** @type {import('../../shared/schema.js').VAGlobal} */
  const VA = (/** @type {any} */ (window)).__VA ??= {};

  /** @typedef {import('../../shared/schema.js').Selectors} Selectors */
  /** @typedef {import('../../shared/schema.js').ElementDescriptor} ElementDescriptor */
  /** @typedef {import('../../shared/schema.js').AssistError} AssistError */

  const TEXT_LIMIT = 80;
  const BUTTON_LIKE = new Set(['button', 'submit', 'reset', 'image']);

  /**
   * Descend through shadow hosts. Returns the root to query, or null when a
   * host in the path is missing or closed.
   * @param {string[]} shadowPath
   * @returns {Document | ShadowRoot | null}
   */
  function rootFor(shadowPath) {
    /** @type {Document | ShadowRoot} */
    let root = document;
    for (const hostSelector of shadowPath) {
      /** @type {Element | null} */
      const host = root.querySelector(hostSelector);
      if (!host || !host.shadowRoot) return null;
      root = host.shadowRoot;
    }
    return root;
  }

  /**
   * All elements matching a selector under the shadow path. An invalid
   * selector throws; callers turn that into a named failure.
   * @param {string} selector
   * @param {string[]} [shadowPath]
   * @returns {Element[]}
   */
  function queryAll(selector, shadowPath = []) {
    const root = rootFor(shadowPath);
    if (!root) return [];
    return Array.from(root.querySelectorAll(selector));
  }

  /**
   * Visible means rendered with a box and not hidden by CSS. `<option>`
   * elements count as visible when their `<select>` is.
   * @param {Element} el
   * @returns {boolean}
   */
  function isVisible(el) {
    if (el instanceof HTMLOptionElement) {
      return el.closest('select') ? isVisible(/** @type {Element} */ (el.closest('select'))) : false;
    }
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (el instanceof HTMLElement && el.hidden) return false;
    if (el.getClientRects().length === 0) return false;
    return true;
  }

  /**
   * @param {string | null | undefined} s
   * @returns {string}
   */
  function clean(s) {
    return (s ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Attributes the guard inspects. `value` is included only for button-like
   * controls so no field value ever leaves the page inside a descriptor.
   * @param {Element} el
   * @returns {ElementDescriptor}
   */
  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const type = clean(el.getAttribute('type')).toLowerCase();
    let value = '';
    if (tag === 'button' || (tag === 'input' && BUTTON_LIKE.has(type))) {
      value = clean(/** @type {HTMLInputElement | HTMLButtonElement} */ (el).value);
    }
    let text = clean(el.textContent);
    if (text.length > TEXT_LIMIT) text = text.slice(0, TEXT_LIMIT);
    return {
      tag,
      type,
      id: clean(el.id),
      name: clean(el.getAttribute('name')),
      text,
      value,
      ariaLabel: clean(el.getAttribute('aria-label')),
      role: clean(el.getAttribute('role')),
      autocomplete: clean(el.getAttribute('autocomplete')),
      placeholder: clean(el.getAttribute('placeholder')),
    };
  }

  /**
   * Candidate selectors in try order.
   * @param {Selectors} selectors
   * @returns {string[]}
   */
  function candidates(selectors) {
    return [selectors.primary, ...(selectors.fallbacks ?? [])];
  }

  /**
   * Visible match count per candidate selector. -1 marks an invalid selector.
   * @param {Selectors} selectors
   * @returns {number[]}
   */
  function countAll(selectors) {
    return candidates(selectors).map((sel) => {
      try {
        return queryAll(sel, selectors.shadowPath).filter(isVisible).length;
      } catch {
        return -1;
      }
    });
  }

  /**
   * Resolve to exactly one visible element.
   * @param {Selectors} selectors
   * @param {string} [field]  Field key or step label, for the message
   * @returns {import('../../shared/schema.js').ResolveResult}
   */
  function resolve(selectors, field = '') {
    const tried = candidates(selectors);
    /** @type {number[]} */
    const counts = [];
    /** @type {string[]} */
    const invalid = [];
    if (selectors.shadowPath.length && rootFor(selectors.shadowPath) === null) {
      return {
        ok: false,
        error: {
          class: 'resolution',
          message: `${field ? `field \`${field}\`: ` : ''}shadow host path [${selectors.shadowPath.join(' > ')}] did not resolve to an open shadow root`,
          field: field || undefined,
          selectors: tried,
          matchCounts: tried.map(() => 0),
        },
      };
    }
    for (const sel of tried) {
      /** @type {Element[]} */
      let matches;
      try {
        matches = queryAll(sel, selectors.shadowPath).filter(isVisible);
      } catch {
        counts.push(-1);
        invalid.push(sel);
        continue;
      }
      counts.push(matches.length);
      if (matches.length === 1) {
        return { ok: true, element: matches[0], selector: sel };
      }
    }
    const ambiguous = counts.some((c) => c > 1);
    const parts = tried.map((sel, i) => `\`${sel}\` matched ${counts[i] === -1 ? 'invalid selector' : `${counts[i]} element${counts[i] === 1 ? '' : 's'}`}`);
    /** @type {AssistError} */
    const error = {
      class: ambiguous ? 'ambiguity' : 'resolution',
      message: `${field ? `field \`${field}\`: ` : ''}${parts.join('; ')}${invalid.length ? ' (invalid CSS is a map bug)' : ''}`,
      field: field || undefined,
      selectors: tried,
      matchCounts: counts,
    };
    return { ok: false, error };
  }

  VA.resolve = { resolve, queryAll, isVisible, describe, countAll };
})();
