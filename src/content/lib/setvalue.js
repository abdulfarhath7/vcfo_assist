// Framework-aware value setting for the content script (classic script,
// isolated world). Installs `window.__VA.setvalue`.
//
// Order, per docs/01: native property setter, then input/change/blur, then
// (from the worker, MAIN world) a jQuery trigger, then read back. This file
// does the first two and the read-back; the jQuery trigger needs page
// globals and is executed by the worker with chrome.scripting.

(() => {
  'use strict';

  /** @type {import('../../shared/schema.js').VAGlobal} */
  const VA = (/** @type {any} */ (window)).__VA ??= {};

  /** @typedef {import('../../shared/schema.js').FieldType} FieldType */
  /** @typedef {import('../../shared/schema.js').FieldEntry} FieldEntry */
  /** @typedef {import('../../shared/schema.js').AssistError} AssistError */

  const MARK_ATTR = 'data-va-mark';
  const DEFAULT_OPTION_SELECTOR = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="treeitem"]';
  const DEFAULT_LISTBOX_SELECTOR = '[role="listbox"], [role="menu"], [role="tree"], [role="grid"]';
  const POLL_MS = 100;
  let markCounter = 0;

  /**
   * @param {string | null | undefined} s
   * @returns {string}
   */
  function norm(s) {
    return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Tag an element so the worker's MAIN-world function can find the same
   * node without re-resolving selectors. Removed by the read-back.
   * @param {Element} el
   * @returns {string}
   */
  function mark(el) {
    markCounter += 1;
    const id = `va-${Date.now().toString(36)}-${markCounter}`;
    el.setAttribute(MARK_ATTR, id);
    return id;
  }

  /**
   * @param {Element} el
   * @param {string} name
   * @param {boolean} [cancelable]
   */
  function fire(el, name, cancelable = true) {
    el.dispatchEvent(new Event(name, { bubbles: true, cancelable }));
  }

  /**
   * @param {Element} el
   */
  function fireInputEvents(el) {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText' }));
    fire(el, 'change');
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  /**
   * The prototype's value setter, bypassing any framework value tracker.
   * @param {Element} el
   * @returns {((v: string) => void) | null}
   */
  function nativeValueSetter(el) {
    /** @type {object} */
    let proto;
    if (el instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
    else if (el instanceof HTMLSelectElement) proto = HTMLSelectElement.prototype;
    else if (el instanceof HTMLInputElement) proto = HTMLInputElement.prototype;
    else return null;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!desc || typeof desc.set !== 'function') return null;
    const setter = desc.set;
    return (v) => setter.call(el, v);
  }

  /**
   * Find a `<select>` option by value or by visible text (case-insensitive).
   * @param {HTMLSelectElement} select
   * @param {string} value
   * @returns {HTMLOptionElement | null}
   */
  function findOption(select, value) {
    const want = norm(value);
    const options = Array.from(select.options);
    return options.find((o) => o.value === value)
      ?? options.find((o) => norm(o.value) === want)
      ?? options.find((o) => norm(o.textContent) === want)
      ?? options.find((o) => norm(o.label) === want)
      ?? null;
  }

  /**
   * Scroll, focus and click with the event sequence jQuery handlers expect.
   * @param {Element} el
   */
  function click(el) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    if (el instanceof HTMLElement) el.focus({ preventScroll: true });
    const init = { bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new PointerEvent('pointerup', init));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    if (el instanceof HTMLElement) el.click();
    else el.dispatchEvent(new MouseEvent('click', init));
  }

  /**
   * Steps 1 and 2: native setter then events. Returns the marker for the
   * MAIN-world trigger. Does not read back; the caller does that after the
   * jQuery trigger has run.
   * @param {Element} el
   * @param {string} value
   * @param {FieldType} type
   * @returns {{ ok: true, marker: string } | { ok: false, error: AssistError }}
   */
  function setNative(el, value, type) {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      return { ok: false, error: { class: 'verification', message: `element is a ${el.type}; use the check op` } };
    }
    if (el instanceof HTMLSelectElement) {
      const option = findOption(el, value);
      if (!option) {
        return {
          ok: false,
          error: { class: 'verification', message: `no option among ${el.options.length} matches the value (by value or text)` },
        };
      }
      const set = nativeValueSetter(el);
      if (!set) return { ok: false, error: { class: 'internal', message: 'no native value setter for select' } };
      el.focus();
      set(option.value);
      option.selected = true;
      fireInputEvents(el);
      return { ok: true, marker: mark(el) };
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.readOnly || el.disabled) {
        return { ok: false, error: { class: 'verification', message: `element is ${el.disabled ? 'disabled' : 'read-only'}` } };
      }
      const set = nativeValueSetter(el);
      if (!set) return { ok: false, error: { class: 'internal', message: 'no native value setter for element' } };
      el.focus();
      el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      set('');
      set(value);
      fireInputEvents(el);
      return { ok: true, marker: mark(el) };
    }
    if (el instanceof HTMLElement && el.isContentEditable) {
      el.focus();
      el.textContent = value;
      fireInputEvents(el);
      return { ok: true, marker: mark(el) };
    }
    return {
      ok: false,
      error: { class: 'verification', message: `element <${el.tagName.toLowerCase()}> is not a text control; expected type "${type}"` },
    };
  }

  /**
   * What the page holds now. `actual` is what a person sees; `alt` is the
   * underlying value where the two differ (select option value, data-value).
   * Removes the marker.
   * @param {Element} el
   * @param {FieldType} type
   * @returns {{ actual: string, alt: string }}
   */
  function readBack(el, type) {
    el.removeAttribute(MARK_ATTR);
    if (el instanceof HTMLSelectElement) {
      const o = el.selectedOptions[0];
      return { actual: (o?.textContent ?? '').trim(), alt: o?.value ?? el.value };
    }
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') return { actual: String(el.checked), alt: el.value };
      return { actual: el.value, alt: el.value };
    }
    if (el instanceof HTMLTextAreaElement) return { actual: el.value, alt: el.value };
    if (el instanceof HTMLElement && el.isContentEditable) {
      return { actual: (el.textContent ?? '').trim(), alt: el.innerText.trim() };
    }
    const ariaText = el.getAttribute('aria-valuetext') ?? '';
    const dataValue = el.getAttribute('data-value') ?? el.getAttribute('value') ?? '';
    const text = (type === 'select' ? (el.textContent ?? '') : (el.textContent ?? '')).replace(/\s+/g, ' ').trim();
    return { actual: ariaText || text, alt: dataValue };
  }

  /**
   * Checkbox or radio. Clicking rather than setting `checked` keeps the
   * page's own handlers in the loop.
   * @param {Element} el
   * @param {boolean} checked
   * @returns {{ ok: true, actual: string } | { ok: false, error: AssistError }}
   */
  function setChecked(el, checked) {
    if (!(el instanceof HTMLInputElement) || !(el.type === 'checkbox' || el.type === 'radio')) {
      return { ok: false, error: { class: 'verification', message: `element <${el.tagName.toLowerCase()}> is not a checkbox or radio` } };
    }
    if (el.disabled) return { ok: false, error: { class: 'verification', message: 'element is disabled' } };
    if (el.checked !== checked) {
      if (el.type === 'radio' && !checked) {
        return { ok: false, error: { class: 'verification', message: 'a radio cannot be unchecked; check another option instead' } };
      }
      click(el);
    }
    return { ok: true, actual: String(el.checked) };
  }

  /**
   * Text for the result capture.
   * @param {Element} el
   * @param {'text' | 'value' | 'attribute'} mode
   * @param {string} [attribute]
   * @returns {string}
   */
  function readText(el, mode, attribute) {
    if (mode === 'attribute') return attribute ? (el.getAttribute(attribute) ?? '') : '';
    if (mode === 'value') {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;
      return el.getAttribute('value') ?? '';
    }
    return (el instanceof HTMLElement ? el.innerText : el.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Visible option elements for a widget, scoped to the declared listbox
   * when one is given.
   * @param {FieldEntry} entry
   * @returns {Element[]}
   */
  function visibleOptions(entry) {
    const resolveApi = VA.resolve;
    if (!resolveApi) return [];
    const optionSelector = entry.optionSelector ?? DEFAULT_OPTION_SELECTOR;
    /** @type {Element[]} */
    let scope;
    if (entry.listboxSelector) {
      scope = resolveApi.queryAll(entry.listboxSelector).filter(resolveApi.isVisible);
    } else {
      scope = resolveApi.queryAll(DEFAULT_LISTBOX_SELECTOR).filter(resolveApi.isVisible);
    }
    /** @type {Element[]} */
    const options = [];
    if (scope.length) {
      for (const box of scope) options.push(...Array.from(box.querySelectorAll(optionSelector)));
    } else {
      options.push(...resolveApi.queryAll(optionSelector));
    }
    return options.filter(resolveApi.isVisible);
  }

  /**
   * Widget-mode entry: open the control, wait for its options, click the one
   * whose text or value matches, then report what the control shows.
   * Native selects and text-like date pickers take the direct path.
   * @param {Element} el
   * @param {string} value
   * @param {FieldEntry} entry
   * @param {number} timeoutMs
   * @returns {Promise<{ ok: true, actual: string } | { ok: false, error: AssistError }>}
   */
  async function pickWidget(el, value, entry, timeoutMs) {
    if (el instanceof HTMLSelectElement || entry.widgetKind === 'native') {
      const set = setNative(el, value, 'select');
      if (!set.ok) return set;
      return { ok: true, actual: readBack(el, 'select').actual };
    }
    if (entry.widgetKind === 'checkbox' || entry.widgetKind === 'radio') {
      const wanted = ['true', '1', 'yes', 'on'].includes(norm(value));
      return setChecked(el, wanted);
    }
    if (entry.widgetKind === 'datepicker') {
      const set = setNative(el, value, 'date');
      if (!set.ok) return set;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(POLL_MS);
      return { ok: true, actual: readBack(el, 'date').actual };
    }

    // listbox / combobox
    click(el);
    if (entry.widgetKind === 'combobox') {
      const input = el instanceof HTMLInputElement ? el : el.querySelector('input');
      if (input instanceof HTMLInputElement) {
        const set = nativeValueSetter(input);
        if (set) {
          set(value);
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        }
      }
    }
    const want = norm(value);
    const deadline = Date.now() + Math.max(POLL_MS, timeoutMs);
    /** @type {Element | null} */
    let target = null;
    let seen = 0;
    while (Date.now() < deadline) {
      const options = visibleOptions(entry);
      seen = options.length;
      target = options.find((o) => norm(o.getAttribute('data-value') ?? o.getAttribute('value')) === want && want !== '')
        ?? options.find((o) => norm(o.textContent) === want)
        ?? null;
      if (target) break;
      await sleep(POLL_MS);
    }
    if (!target) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        ok: false,
        error: {
          class: seen === 0 ? 'timeout' : 'verification',
          message: seen === 0
            ? `no options appeared within ${timeoutMs}ms after opening the control (option selector \`${entry.optionSelector ?? DEFAULT_OPTION_SELECTOR}\`)`
            : `none of the ${seen} visible options matches the value (by text or data-value)`,
        },
      };
    }
    click(target);
    await sleep(POLL_MS * 2);
    return { ok: true, actual: readBack(el, 'select').actual };
  }

  VA.setvalue = { setNative, readBack, pickWidget, setChecked, readText, click, mark };
})();
