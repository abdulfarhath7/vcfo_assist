// Content-script message bridge (classic script, isolated world, MCA only).
// Listens for `va.op` messages from the service worker, executes one op with
// the primitives in window.__VA, and replies `{ ok, value }` or
// `{ ok, error }`. Installs nothing in the page until an op asks for it.
//
// Every selector, pattern and rule arrives inside the message. The danger
// set and credential set are re-checked here, right before acting, with the
// same patterns the worker applied.

(() => {
  'use strict';

  /** @type {import('../shared/schema.js').VAGlobal} */
  const VA = (/** @type {any} */ (window)).__VA ??= {};
  if (VA.bridgeInstalled) return;
  VA.bridgeInstalled = true;

  /** @typedef {import('../shared/schema.js').Selectors} Selectors */
  /** @typedef {import('../shared/schema.js').AssistError} AssistError */
  /** @typedef {import('../shared/schema.js').ContentRequest} ContentRequest */
  /** @typedef {import('../shared/schema.js').ContentResponse} ContentResponse */
  /** @typedef {import('../shared/schema.js').ElementDescriptor} ElementDescriptor */
  /** @typedef {import('../shared/schema.js').PatternSet} PatternSet */
  /** @typedef {import('../shared/schema.js').FieldEntry} FieldEntry */
  /** @typedef {import('../shared/schema.js').FieldType} FieldType */

  const OP_TYPE = 'va.op';
  const INSTALLED_AT = new Date().toISOString();

  /* ---------------------------------------------------------------------- */
  /* Argument readers                                                        */
  /* ---------------------------------------------------------------------- */

  /**
   * @param {Record<string, unknown>} args
   * @param {string} key
   * @returns {string}
   */
  function str(args, key) {
    const v = args[key];
    return typeof v === 'string' ? v : '';
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {string} key
   * @param {number} fallback
   * @returns {number}
   */
  function num(args, key, fallback) {
    const v = args[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  /**
   * @param {unknown} v
   * @returns {v is Record<string, unknown>}
   */
  function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  /**
   * @param {Record<string, unknown>} args
   * @returns {Selectors | null}
   */
  function selectorsArg(args) {
    const raw = args.selectors;
    if (!isRecord(raw) || typeof raw.primary !== 'string') return null;
    const fallbacks = Array.isArray(raw.fallbacks) ? raw.fallbacks.filter((x) => typeof x === 'string') : [];
    const shadowPath = Array.isArray(raw.shadowPath) ? raw.shadowPath.filter((x) => typeof x === 'string') : [];
    const stability = raw.stability === 'fragile' || raw.stability === 'likely' ? raw.stability : 'stable';
    return { primary: raw.primary, fallbacks, shadowPath, stability };
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {string} key
   * @returns {PatternSet | null}
   */
  function patternSetArg(args, key) {
    const raw = args[key];
    if (!isRecord(raw) || typeof raw.pattern !== 'string') return null;
    const types = Array.isArray(raw.types) ? raw.types.filter((x) => typeof x === 'string') : [];
    return { pattern: raw.pattern, flags: typeof raw.flags === 'string' ? raw.flags : 'i', types };
  }

  /**
   * @param {Record<string, unknown>} args
   * @returns {FieldEntry}
   */
  function entryArg(args) {
    const raw = args.entry;
    /** @type {FieldEntry} */
    const entry = { mode: 'typed', widgetKind: null };
    if (!isRecord(raw)) return entry;
    if (raw.mode === 'widget' || raw.mode === 'unknown' || raw.mode === 'typed') entry.mode = raw.mode;
    if (typeof raw.widgetKind === 'string') {
      entry.widgetKind = /** @type {import('../shared/schema.js').WidgetKind} */ (raw.widgetKind);
    }
    if (typeof raw.listboxSelector === 'string') entry.listboxSelector = raw.listboxSelector;
    if (typeof raw.optionSelector === 'string') entry.optionSelector = raw.optionSelector;
    return entry;
  }

  /* ---------------------------------------------------------------------- */
  /* Rule checks                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Danger-set match against text, value, id, name, aria-label and type.
   * @param {ElementDescriptor} d
   * @param {PatternSet} set
   * @returns {string | null}  The attribute that matched, or null
   */
  function dangerMatch(d, set) {
    if (set.types.includes(d.type)) return `type="${d.type}"`;
    const re = new RegExp(set.pattern, set.flags);
    /** @type {[string, string][]} */
    const attrs = [['text', d.text], ['value', d.value], ['id', d.id], ['name', d.name], ['aria-label', d.ariaLabel], ['type', d.type]];
    for (const [name, v] of attrs) {
      if (v && re.test(v)) return `${name}="${v}"`;
    }
    return null;
  }

  /**
   * Credential match against id, name, type, autocomplete, placeholder and
   * aria-label.
   * @param {ElementDescriptor} d
   * @param {PatternSet} set
   * @returns {string | null}
   */
  function credentialMatch(d, set) {
    if (set.types.includes(d.type)) return `type="${d.type}"`;
    const re = new RegExp(set.pattern, set.flags);
    /** @type {[string, string][]} */
    const attrs = [['id', d.id], ['name', d.name], ['autocomplete', d.autocomplete], ['placeholder', d.placeholder], ['aria-label', d.ariaLabel]];
    for (const [name, v] of attrs) {
      if (v && re.test(v)) return `${name}="${v}"`;
    }
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * @param {AssistError['class']} cls
   * @param {string} message
   * @param {Partial<AssistError>} [extra]
   * @returns {ContentResponse}
   */
  function fail(cls, message, extra) {
    return { ok: false, error: { class: cls, message, ...(extra ?? {}) } };
  }

  /**
   * @param {unknown} value
   * @returns {ContentResponse}
   */
  function ok(value) {
    return { ok: true, value };
  }

  /**
   * Resolve selectors from args, naming the field on failure.
   * @param {Record<string, unknown>} args
   * @returns {{ ok: true, element: Element, selector: string } | { ok: false, response: ContentResponse }}
   */
  function resolveFromArgs(args) {
    const resolveApi = VA.resolve;
    if (!resolveApi) return { ok: false, response: fail('internal', 'resolve primitives are not installed') };
    const selectors = selectorsArg(args);
    if (!selectors) return { ok: false, response: fail('internal', 'op is missing selectors') };
    const r = resolveApi.resolve(selectors, str(args, 'field'));
    if (!r.ok) return { ok: false, response: { ok: false, error: r.error } };
    return { ok: true, element: r.element, selector: r.selector };
  }

  /* ---------------------------------------------------------------------- */
  /* Ops                                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * @param {string} op
   * @param {Record<string, unknown>} args
   * @returns {Promise<ContentResponse>}
   */
  async function execute(op, args) {
    const resolveApi = VA.resolve;
    const observeApi = VA.observe;
    const setvalueApi = VA.setvalue;
    if (!resolveApi || !observeApi || !setvalueApi) {
      return fail('internal', 'content primitives are not installed (resolve/observe/setvalue)');
    }
    const field = str(args, 'field');

    switch (op) {
      case 'ping':
        // Readiness handshake: echo the runId so the worker knows it is
        // talking to a live bridge for this run, not a stale frame.
        return ok({ ready: true, url: location.href, runId: str(args, 'runId'), installedAt: INSTALLED_AT });

      case 'describePage':
        return ok({ url: location.href, title: document.title });

      case 'exists': {
        const selectors = selectorsArg(args);
        if (!selectors) return fail('internal', 'exists is missing selectors');
        const counts = resolveApi.countAll(selectors);
        return ok({ found: counts.some((c) => c > 0), counts });
      }

      case 'inspect': {
        const r = resolveFromArgs(args);
        if (!r.ok) return r.response;
        return ok({ descriptor: resolveApi.describe(r.element), selector: r.selector });
      }

      case 'click': {
        const danger = patternSetArg(args, 'danger');
        if (!danger) return fail('guard', 'click refused: no danger set supplied with the op');
        const r = resolveFromArgs(args);
        if (!r.ok) return r.response;
        const d = resolveApi.describe(r.element);
        const hit = dangerMatch(d, danger);
        if (hit) {
          return fail('guard', `click refused: \`${r.selector}\` targets a control matching the danger set (${hit}). The human does this.`, { selectors: [r.selector] });
        }
        setvalueApi.click(r.element);
        return ok({ descriptor: d, selector: r.selector });
      }

      case 'setValue': {
        const credential = patternSetArg(args, 'credential');
        if (!credential) return fail('credential', 'fill refused: no credential set supplied with the op');
        const r = resolveFromArgs(args);
        if (!r.ok) return r.response;
        const d = resolveApi.describe(r.element);
        const hit = credentialMatch(d, credential);
        if (hit) {
          return fail('credential', `field \`${field}\`: refused, \`${r.selector}\` is a credential control (${hit})`, { field, selectors: [r.selector] });
        }
        const type = /** @type {FieldType} */ (str(args, 'type') || 'text');
        const set = setvalueApi.setNative(r.element, str(args, 'value'), type);
        if (!set.ok) {
          return fail(set.error.class, `field \`${field}\`: ${set.error.message}`, { field, selectors: [r.selector] });
        }
        return ok({ marker: set.marker, selector: r.selector });
      }

      case 'readBack': {
        const r = resolveFromArgs(args);
        if (!r.ok) return r.response;
        const type = /** @type {FieldType} */ (str(args, 'type') || 'text');
        return ok({ ...setvalueApi.readBack(r.element, type), selector: r.selector });
      }

      case 'pickWidget': {
        const credential = patternSetArg(args, 'credential');
        if (!credential) return fail('credential', 'fill refused: no credential set supplied with the op');
        const r = resolveFromArgs(args);
        if (!r.ok) return r.response;
        const d = resolveApi.describe(r.element);
        const hit = credentialMatch(d, credential);
        if (hit) {
          return fail('credential', `field \`${field}\`: refused, \`${r.selector}\` is a credential control (${hit})`, { field, selectors: [r.selector] });
        }
        const picked = await setvalueApi.pickWidget(r.element, str(args, 'value'), entryArg(args), num(args, 'timeoutMs', 5000));
        if (!picked.ok) {
          return fail(picked.error.class, `field \`${field}\`: ${picked.error.message}`, { field, selectors: [r.selector] });
        }
        return ok({ actual: picked.actual, selector: r.selector });
      }

      case 'check': {
        const r = resolveFromArgs(args);
        if (!r.ok) return r.response;
        const set = setvalueApi.setChecked(r.element, args.checked === true);
        if (!set.ok) {
          return fail(set.error.class, `field \`${field}\`: ${set.error.message}`, { field, selectors: [r.selector] });
        }
        return ok({ actual: set.actual, selector: r.selector });
      }

      case 'waitFor': {
        const selectors = selectorsArg(args);
        if (!selectors) return fail('internal', 'waitFor is missing selectors');
        const found = await observeApi.waitFor(selectors, num(args, 'timeoutMs', 5000));
        return ok({ found, url: location.href });
      }

      case 'waitForGone': {
        const selector = str(args, 'selector');
        if (!selector) return fail('internal', 'waitForGone is missing a selector');
        const gone = await observeApi.waitForGone(selector, num(args, 'timeoutMs', 5000));
        return ok({ gone });
      }

      case 'waitForUrl': {
        const pattern = str(args, 'pattern');
        if (!pattern) return fail('internal', 'waitForUrl is missing a pattern');
        return ok(await observeApi.waitForUrl(pattern, num(args, 'timeoutMs', 5000)));
      }

      case 'settle': {
        const settled = await observeApi.settle(num(args, 'quietMs', 400), num(args, 'maxMs', 5000));
        return ok({ settled });
      }

      case 'readText': {
        const r = resolveFromArgs(args);
        if (!r.ok) return r.response;
        const read = str(args, 'read');
        const mode = read === 'value' || read === 'attribute' ? read : 'text';
        return ok({ text: setvalueApi.readText(r.element, mode, str(args, 'attribute') || undefined), selector: r.selector });
      }

      default:
        return fail('internal', `unknown content op "${op}"`);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Listener                                                                */
  /* ---------------------------------------------------------------------- */

  chrome.runtime.onMessage.addListener(
    /**
     * @param {unknown} message
     * @param {chrome.runtime.MessageSender} sender
     * @param {(response: ContentResponse) => void} sendResponse
     * @returns {boolean | undefined}
     */
    (message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return undefined;
      if (!isRecord(message) || message.type !== OP_TYPE) return undefined;
      const op = typeof message.op === 'string' ? message.op : '';
      const args = isRecord(message.args) ? message.args : {};
      execute(op, args)
        .then(sendResponse)
        .catch((e) => {
          sendResponse(fail('internal', `content op "${op}" threw: ${e instanceof Error ? e.message : String(e)}`));
        });
      return true;
    },
  );
})();
