/* vCFO Assist — content script for www.mca.gov.in
 * Fills AEM Adaptive Form fields on SPICe+ pages from a vCFO profile, scans current
 * values, and discovers fields on pages/sections that are not in the bundled schemas.
 */
(function () {
  'use strict';
  if (window.__vcfoAssistLoaded) return;
  window.__vcfoAssistLoaded = true;

  const FORM_BY_PAGE = {
    'spice.html': 'spice-part-a', 'SpicePartB.html': 'spice-part-b', 'AgilePro.html': 'agile-pro-s',
    'INC-33.html': 'inc-33-emoa', 'INC-34.html': 'inc-34-eaoa', 'INC-9.html': 'inc-9', 'fologin.html': 'login',
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (el) => !!el && el.getClientRects().length > 0 && (!el.checkVisibility || el.checkVisibility());
  const schemaCache = {};

  function detectForm() {
    const base = location.pathname.split('/').pop();
    return FORM_BY_PAGE[base] || null;
  }

  async function loadSchema(formKey) {
    if (!formKey) return null;
    if (!schemaCache[formKey]) {
      const res = await fetch(chrome.runtime.getURL(`schemas/${formKey}.compact.json`));
      schemaCache[formKey] = res.ok ? await res.json() : null;
    }
    return schemaCache[formKey];
  }

  /* ---------- locating fields ---------- */
  function nodesForKey(schema, key) {
    const f = schema && schema.fields.find((x) => x.key === key);
    let nodes = [];
    if (f && f.sem) nodes = Array.from(document.querySelectorAll('.guideFieldNode.' + CSS.escape(f.sem)));
    if (!nodes.length && f) { const byId = document.getElementById(f.id); if (byId) nodes = [byId]; }
    if (!nodes.length) nodes = Array.from(document.querySelectorAll('.guideFieldNode.' + CSS.escape(key)));   // key given as raw semantic class
    if (!nodes.length && f && f.label) {                                                                        // last resort: label text
      const want = norm(f.label.replace(/^\*|\*$/g, ''));
      nodes = Array.from(document.querySelectorAll('.guideFieldNode')).filter((n) => { const l = n.querySelector('.guideFieldLabel'); return l && norm(l.textContent).replace(/^\*/, '') === want.replace(/^\*/, ''); });
    }
    return { field: f, nodes };
  }

  function widgetOf(node) {
    return node.querySelector('select, textarea, input:not([type=hidden]):not([type=button]):not([type=submit])');
  }

  /* ---------- setting values ---------- */
  function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
  }
  function fire(el, types) { types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true, cancelable: true }))); }

  function matchOption(select, value) {
    const v = norm(value);
    const opts = Array.from(select.options);
    return opts.find((o) => norm(o.value) === v) || opts.find((o) => norm(o.text) === v) || opts.find((o) => norm(o.text).startsWith(v)) || opts.find((o) => norm(o.text).includes(v)) || null;
  }

  async function setSelect(select, value, wait) {
    const deadline = Date.now() + (wait ? 8000 : 800);
    let opt = matchOption(select, value);
    while (!opt && Date.now() < deadline) { await sleep(300); opt = matchOption(select, value); }
    if (!opt) return { status: 'nomatch', msg: `no option like "${value}" (${select.options.length} options)` };
    select.focus();
    setNative(select, opt.value);
    select.selectedIndex = opt.index;
    fire(select, ['input', 'change', 'blur']);
    return { status: 'filled', msg: opt.text.trim() };
  }

  function setChoice(node, value) {
    const inputs = Array.from(node.querySelectorAll('input[type=radio], input[type=checkbox]'));
    if (!inputs.length) return { status: 'notfound', msg: 'no radio/checkbox inputs' };
    const labelOf = (i) => norm((i.closest('label') || node.querySelector(`label[for="${i.id}"]`) || i.parentElement || {}).textContent);
    const v = norm(value);
    if (inputs.length === 1 && (typeof value === 'boolean' || v === 'true' || v === 'false')) {
      const want = value === true || v === 'true';
      if (inputs[0].checked !== want) { inputs[0].click(); fire(inputs[0], ['change']); }
      return { status: 'filled', msg: want ? 'checked' : 'unchecked' };
    }
    const aliases = { yes: ['yes', 'y', 'true'], no: ['no', 'n', 'false'] };
    const wanted = aliases[v] || [v];
    const hit = inputs.find((i) => wanted.includes(norm(i.value))) || inputs.find((i) => wanted.some((w) => labelOf(i) === w)) || inputs.find((i) => wanted.some((w) => labelOf(i).startsWith(w)));
    if (!hit) return { status: 'nomatch', msg: `options: ${inputs.map((i) => labelOf(i) || i.value).join(' | ')}` };
    if (!hit.checked) { hit.click(); fire(hit, ['change']); }
    return { status: 'filled', msg: labelOf(hit) || hit.value };
  }

  async function fillOne(schema, item) {
    const { field, nodes } = nodesForKey(schema, item.key);
    const node = nodes[item.instance || 0];
    const label = field ? field.label : item.key;
    if (!node) return { key: item.key, label, status: nodes.length ? 'noinstance' : 'notfound', msg: nodes.length ? `only ${nodes.length} instance(s) on page; open Add/Edit for #${(item.instance || 0) + 1}` : 'field not on this page/section' };
    if (!visible(node)) return { key: item.key, label, status: 'hidden', msg: 'field hidden (different section or conditional)' };
    const type = field ? field.type : (node.className.match(/guide(\w+)/) || [, ''])[1].toLowerCase();
    if (type === 'fileupload') return { key: item.key, label, status: 'manual', msg: 'file upload: attach manually' };
    if (type === 'radiobutton' || type === 'checkbox') return Object.assign({ key: item.key, label }, setChoice(node, item.value));
    const w = widgetOf(node);
    if (!w) return { key: item.key, label, status: 'notfound', msg: 'no input widget' };
    if (w.readOnly || w.disabled || node.getAttribute('data-disabled') === 'true') return { key: item.key, label, status: 'readonly', msg: `read-only (current: "${w.value}")` };
    if (w.tagName === 'SELECT') return Object.assign({ key: item.key, label }, await setSelect(w, item.value, item.waitForOptions));
    w.focus();
    setNative(w, String(item.value));
    fire(w, ['input', 'keyup', 'change', 'blur']);
    return { key: item.key, label, status: 'filled', msg: String(item.value) };
  }

  function flash(item, ok) {
    const { nodes } = nodesForKey(schemaCache[detectForm()], item.key);
    const n = nodes[item.instance || 0]; if (!n) return;
    n.style.outline = ok ? '2px solid #2e7d32' : '2px solid #c62828';
    setTimeout(() => { n.style.outline = ''; }, 4000);
  }

  async function fillForm(items, opts = {}) {
    const formKey = detectForm();
    const schema = await loadSchema(formKey);
    const report = [];
    for (const item of items) {
      if (opts.onlyKeys && !opts.onlyKeys.includes(item.key)) continue;
      const r = await fillOne(schema, item);
      if (item.note) r.note = item.note;
      report.push(r);
      flash(item, r.status === 'filled');
      await sleep(/pin|pincode/i.test(item.key) && r.status === 'filled' ? 2000 : 120);   // pincode triggers portal lookups
    }
    return { formKey, report };
  }

  /* ---------- reading the page ---------- */
  function describeNode(node) {
    const cls = Array.from(node.classList);
    const type = (cls.find((c) => /^guide[A-Z]/.test(c) && c !== 'guideFieldNode') || 'guideUnknown').slice(5).toLowerCase();
    const GENERIC = /^(guide|af-|defaultFieldLayout|mca-)/;
    const sem = cls.find((c) => !GENERIC.test(c)) || null;
    const lab = node.querySelector('.guideFieldLabel');
    const w = widgetOf(node);
    const panels = [];
    for (let p = node.parentElement; p; p = p.parentElement) {
      if (p.classList.contains('guidePanel')) { const h = p.querySelector(':scope > .guidePanelDescription, :scope > .guideHeader, :scope > div > .guideHeader'); const t = p.getAttribute('title') || (h ? h.textContent.trim() : ''); if (t) panels.unshift(t.slice(0, 80)); }
    }
    const d = { id: node.id, key: sem || node.id, sem, label: lab ? lab.textContent.trim().slice(0, 200) : '', type, req: node.getAttribute('data-mandatory') === 'true' || undefined,
      ro: (node.getAttribute('data-disabled') === 'true' || (w && (w.readOnly || w.disabled))) || undefined, visible: visible(node) || undefined,
      wid: w ? w.id : undefined, itype: w ? w.type : undefined, max: w && w.maxLength > 0 ? w.maxLength : undefined, panels: panels.slice(-3) };
    if (w && w.tagName === 'SELECT') d.options = Array.from(w.options).map((o) => ({ v: o.value, t: o.text.trim() })).slice(0, 300);
    if (type === 'radiobutton' || type === 'checkbox') d.options = Array.from(node.querySelectorAll('input')).map((i) => ({ v: i.value, t: (i.closest('label') || i.parentElement).textContent.trim().slice(0, 80) }));
    let value = w ? (w.type === 'password' ? undefined : w.value) : undefined;
    if (type === 'radiobutton' || type === 'checkbox') { const c = Array.from(node.querySelectorAll('input')).filter((i) => i.checked); value = c.map((i) => i.value).join(','); }
    if (value !== undefined && value !== '') d.value = value;
    return d;
  }

  function discoverFields() {
    const seen = new Set();
    return Array.from(document.querySelectorAll('.guideFieldNode')).filter((n) => n.id && !seen.has(n.id) && seen.add(n.id)).map(describeNode);
  }

  async function detect() {
    const formKey = detectForm();
    const schema = await loadSchema(formKey);
    const present = schema ? schema.fields.filter((f) => nodesForKey(schema, f.key).nodes.length).length : 0;
    const wizard = Array.from(document.querySelectorAll('li.listep .text')).map((e) => e.textContent.trim());
    return { formKey, url: location.href, title: document.title, schemaFields: schema ? schema.fields.length : 0, presentFields: present, liveFields: document.querySelectorAll('.guideFieldNode').length, wizard };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === 'DETECT') return sendResponse(await detect());
        if (msg.type === 'FILL') {
          const formKey = msg.formKey || detectForm();
          const items = msg.items || window.VCFO_MAPPING.map(formKey, msg.profile);
          return sendResponse(await fillForm(items, { onlyKeys: msg.onlyKeys }));
        }
        if (msg.type === 'PREVIEW') { const formKey = msg.formKey || detectForm(); return sendResponse({ formKey, items: window.VCFO_MAPPING.map(formKey, msg.profile) }); }
        if (msg.type === 'SCAN') return sendResponse({ formKey: detectForm(), fields: discoverFields().filter((f) => f.value !== undefined) });
        if (msg.type === 'DISCOVER') return sendResponse({ formKey: detectForm(), url: location.href, wizard: (await detect()).wizard, fields: discoverFields() });
        sendResponse({ error: 'unknown message ' + msg.type });
      } catch (e) { sendResponse({ error: e.message, stack: e.stack }); }
    })();
    return true;
  });
})();
