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
  /** The control inside an AEM `.guideFieldNode`, as the reference build's filler.js finds it. */
  const GUIDE_WIDGET = 'select, textarea, input:not([type=hidden]):not([type=button]):not([type=submit])';

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
   * `guideFieldNode "proposedname1" #1` — the label used in messages.
   * @param {Selectors} selectors
   * @returns {string}
   */
  function guideLabel(selectors) {
    return `guideFieldNode "${selectors.key ?? ''}" #${(selectors.instance ?? 0) + 1}`;
  }

  /**
   * Every `.guideFieldNode` carrying the semantic class, in document order.
   * Throws on a key that is not a valid class name.
   * @param {string} key
   * @returns {Element[]}
   */
  function guideNodes(key) {
    return Array.from(document.querySelectorAll(`.guideFieldNode.${CSS.escape(key)}`));
  }

  /**
   * AEM semantic-key resolution, ported from the reference build's
   * `content/filler.js` (`nodesForKey` + `widgetOf`). With `instance` the nth
   * node is the field (repeat-panel rows share one class); without it exactly
   * one visible node must carry the class. The element returned is the
   * control inside the node.
   * @param {Selectors} selectors
   * @param {string} field
   * @returns {import('../../shared/schema.js').ResolveResult}
   */
  function resolveGuideFieldNode(selectors, field) {
    const key = selectors.key ?? '';
    const label = guideLabel(selectors);
    const prefix = field ? `field \`${field}\`: ` : '';
    /**
     * @param {'resolution' | 'ambiguity'} cls
     * @param {string} message
     * @param {number} count
     * @returns {import('../../shared/schema.js').ResolveResult}
     */
    const failWith = (cls, message, count) => ({
      ok: false,
      error: { class: cls, message: `${prefix}${label}: ${message}`, field: field || undefined, selectors: [label], matchCounts: [count] },
    });
    if (!key) return failWith('resolution', 'the map gives no semantic key', 0);
    /** @type {Element[]} */
    let nodes;
    try {
      nodes = guideNodes(key);
    } catch {
      return failWith('resolution', `"${key}" is not a valid class name (map bug)`, -1);
    }
    /** @type {Element | undefined} */
    let node;
    if (selectors.instance !== undefined) {
      node = nodes[selectors.instance];
      if (!node) {
        return failWith('resolution', nodes.length
          ? `only ${nodes.length} instance${nodes.length === 1 ? '' : 's'} on the page; open Add/Edit for #${selectors.instance + 1} first`
          : 'no field with this key on this page or section', nodes.length);
      }
      if (!isVisible(node)) return failWith('resolution', 'the field is hidden (another section, or a condition not met yet)', 0);
    } else {
      const shown = nodes.filter(isVisible);
      if (shown.length > 1) return failWith('ambiguity', `${shown.length} visible fields carry this key`, shown.length);
      node = shown[0];
      if (!node) {
        return failWith('resolution', nodes.length
          ? 'the field is hidden (another section, or a condition not met yet)'
          : 'no field with this key on this page or section', 0);
      }
    }
    const control = node.querySelector(GUIDE_WIDGET);
    if (!control) return failWith('resolution', 'no input, select or textarea inside the field', 1);
    return { ok: true, element: control, selector: label };
  }

  /**
   * Visible match count per candidate selector. -1 marks an invalid selector.
   * A guideFieldNode target counts as one entry: 1 when it resolves, else 0.
   * @param {Selectors} selectors
   * @returns {number[]}
   */
  function countAll(selectors) {
    if (selectors.strategy === 'guideFieldNode') {
      return [resolveGuideFieldNode(selectors, '').ok ? 1 : 0];
    }
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
    if (selectors.strategy === 'guideFieldNode') return resolveGuideFieldNode(selectors, field);
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
