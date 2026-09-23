// MCA portal DOM recorder for vCFO Assist extension research.
// Launches a headed Chromium with a persistent profile, opens the MCA portal,
// and captures DOM / screenshots / network / user events for every step the
// user walks through (intended: SPICe+ Part A + Part B incorporation).
//
// Usage: node recorder.js [startUrl]
// Stop:  close the browser window, or `kill $(cat recorder.pid)`.

const { chromium } = require('/usr/share/nodejs/playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = path.join(ROOT, 'steps', RUN_ID);
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'recorder.pid'), String(process.pid));

const START_URL = process.argv[2] || 'https://www.mca.gov.in/';
const CHROME = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
const SECRET_RE = /passw|pwd|(^|[^a-z])otp([^a-z]|$)|captcha|token|secret/i;

const eventsFile = fs.createWriteStream(path.join(RUN_DIR, 'events.jsonl'), { flags: 'a' });
const netFile = fs.createWriteStream(path.join(RUN_DIR, 'network.jsonl'), { flags: 'a' });
const log = (...a) => { const s = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(s); fs.appendFileSync(path.join(ROOT, 'recorder.log'), s + '\n'); };
const jl = (stream, obj) => stream.write(JSON.stringify(obj) + '\n');

let step = 0;
const lastHash = new Map(); // page -> hash

function redactBody(body) {
  if (!body) return body;
  try {
    const j = JSON.parse(body);
    const walk = (o) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (SECRET_RE.test(k)) o[k] = '<redacted>'; else walk(o[k]); } };
    walk(j); return JSON.stringify(j);
  } catch { return body.replace(/((?:pass|pwd|otp|captcha|token)[^=&]*=)[^&]*/gi, '$1<redacted>'); }
}

// Runs inside the page: inventory of interactive elements + labels.
const INVENTORY_JS = `(() => {
  const SECRET = /passw|pwd|(^|[^a-z])otp([^a-z]|$)|captcha|token|secret/i;
  const cssPath = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      let s = el.nodeName.toLowerCase();
      if (el.id) { parts.unshift(s + '#' + CSS.escape(el.id)); break; }
      const sib = Array.from(el.parentNode ? el.parentNode.children : []).filter(c => c.nodeName === el.nodeName);
      if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(el) + 1) + ')';
      parts.unshift(s); el = el.parentNode;
    }
    return parts.join(' > ');
  };
  const xpath = (el) => {
    if (el.id) return '//*[@id="' + el.id + '"]';
    const parts = [];
    while (el && el.nodeType === 1) {
      let i = 1, s = el.previousElementSibling;
      while (s) { if (s.nodeName === el.nodeName) i++; s = s.previousElementSibling; }
      parts.unshift(el.nodeName.toLowerCase() + '[' + i + ']'); el = el.parentNode;
    }
    return '/' + parts.join('/');
  };
  const txt = (n) => (n && n.textContent || '').replace(/\\s+/g, ' ').trim();
  const labelFor = (el) => {
    let t = '';
    if (el.labels && el.labels.length) t = Array.from(el.labels).map(txt).join(' | ');
    if (!t && el.getAttribute('aria-label')) t = el.getAttribute('aria-label');
    if (!t && el.getAttribute('aria-labelledby')) t = el.getAttribute('aria-labelledby').split(/\\s+/).map(id => txt(document.getElementById(id))).join(' ').trim();
    if (!t) { const p = el.closest('.guideFieldNode, [class*=guidefield], [class*=guideField], .form-group, .mat-form-field, label, td, li'); if (p) { const l = p.querySelector('label, .guideFieldLabel, legend'); t = l ? txt(l) : txt(p).slice(0, 120); } }
    return t.slice(0, 160);
  };
  const sel = 'input, select, textarea, button, a[href], [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=combobox], [contenteditable=true], [onclick], [ng-click]';
  const out = [];
  document.querySelectorAll(sel).forEach((el) => {
    const r = el.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && (el.checkVisibility ? el.checkVisibility() : true);
    const type = (el.getAttribute('type') || '').toLowerCase();
    const secret = type === 'password' || SECRET.test(el.name || '') || SECRET.test(el.id || '');
    let value = el.value;
    if (el.tagName === 'SELECT') value = Array.from(el.selectedOptions).map(o => o.text).join(',');
    if (secret && value) value = '<redacted>';
    const o = {
      tag: el.tagName.toLowerCase(), type: type || undefined, id: el.id || undefined, name: el.getAttribute('name') || undefined,
      formcontrolname: el.getAttribute('formcontrolname') || undefined, ngmodel: el.getAttribute('ng-model') || el.getAttribute('[(ngModel)]') || undefined,
      class: el.className && typeof el.className === 'string' ? el.className.trim().slice(0, 200) : undefined,
      placeholder: el.getAttribute('placeholder') || undefined, ariaLabel: el.getAttribute('aria-label') || undefined,
      label: labelFor(el) || undefined, text: txt(el).slice(0, 120) || undefined,
      href: el.getAttribute('href') || undefined, value: value === '' ? undefined : value,
      required: el.required || el.getAttribute('aria-required') === 'true' || undefined, disabled: el.disabled || undefined,
      maxlength: el.getAttribute('maxlength') || undefined, pattern: el.getAttribute('pattern') || undefined,
      options: el.tagName === 'SELECT' ? Array.from(el.options).slice(0, 200).map(o => ({ v: o.value, t: o.text.trim() })) : undefined,
      checked: (type === 'checkbox' || type === 'radio') ? el.checked : undefined,
      visible, box: visible ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : undefined,
      css: cssPath(el), xpath: xpath(el),
    };
    Object.keys(o).forEach(k => o[k] === undefined && delete o[k]);
    out.push(o);
  });
  const forms = Array.from(document.forms).map(f => ({ id: f.id, name: f.name, action: f.action, method: f.method, css: cssPath(f) }));
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,legend,.card-title,.panel-title,.mat-tab-label,.nav-link.active,.breadcrumb,.guideFieldLabel h3,.guidePanel > .guideHeader')).map(txt).filter(Boolean).slice(0, 80);
  return { url: location.href, title: document.title, headings, forms, elements: out, iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({ id: f.id, name: f.name, src: f.src })) };
})()`;

// Injected into every frame before scripts run: mutation observer + user-event hooks.
const INIT_JS = `
(() => {
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch {}
  const SECRET = /passw|pwd|(^|[^a-z])otp([^a-z]|$)|captcha|token|secret/i;
  const desc = (el) => {
    if (!el || el.nodeType !== 1) return {};
    return { tag: el.tagName.toLowerCase(), id: el.id || undefined, name: el.getAttribute && (el.getAttribute('name') || el.getAttribute('formcontrolname')) || undefined,
      type: el.getAttribute && el.getAttribute('type') || undefined, text: ((el.type === 'password' || SECRET.test(el.name || '') || SECRET.test(el.id || '')) ? (el.innerText || '') : (el.innerText || el.value || '')).toString().trim().slice(0, 80) || undefined,
      class: typeof el.className === 'string' ? el.className.trim().slice(0, 120) : undefined };
  };
  const send = (kind, data) => { try { window.__vcfoEvent(JSON.stringify({ kind, frame: location.href, ...data })); } catch {} };
  let t = null;
  const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => send('mutation', {}), 900); });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: false }));
  document.addEventListener('click', (e) => send('click', { target: desc(e.target), path: e.composedPath().slice(0, 6).map(desc) }), true);
  document.addEventListener('change', (e) => { const el = e.target; const secret = (el.type === 'password') || SECRET.test(el.name || '') || SECRET.test(el.id || '');
    let v = el.value; if (el.tagName === 'SELECT') v = Array.from(el.selectedOptions).map(o => o.text).join(',');
    if (el.type === 'checkbox' || el.type === 'radio') v = el.checked; if (el.type === 'file') v = Array.from(el.files || []).map(f => f.name).join(',');
    send('change', { target: desc(el), value: secret ? '<redacted>' : v }); }, true);
  document.addEventListener('submit', (e) => send('submit', { target: desc(e.target) }), true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Tab') send('key', { key: e.key, target: desc(e.target) }); }, true);
})();`;

const capState = new Map(); // page -> {running, pending}
async function capture(page, reason) {
  const st = capState.get(page) || { running: false, pending: null };
  capState.set(page, st);
  if (st.running) { st.pending = reason; return; }
  st.running = true;
  try { await captureNow(page, reason); } catch (e) { log('capture error', e.message); }
  st.running = false;
  if (st.pending) { const r = st.pending; st.pending = null; setTimeout(() => capture(page, r), 300); }
}
async function captureNow(page, reason) {
  if (page.isClosed()) return;
  let html;
  try { html = await page.content(); } catch (e) { return; }
  const norm = (x) => x.replace(/\s(class|style|aria-[\w-]+|data-[\w-]+|tabindex)="[^"]*"/g, '').replace(/\s+/g, ' ');
  const h = crypto.createHash('md5').update(norm(html)).digest('hex');
  const frameDumps = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame() || !f.url() || f.url() === 'about:blank') continue;
    try { frameDumps.push({ url: f.url(), name: f.name(), html: await f.content() }); } catch {}
  }
  const key = page._guid || 'p';
  const fullHash = crypto.createHash('md5').update(h + frameDumps.map(f => norm(f.html)).join('')).digest('hex');
  if (lastHash.get(key) === fullHash && reason !== 'manual') return;
  lastHash.set(key, fullHash);

  step += 1;
  const id = String(step).padStart(4, '0');
  const dir = path.join(RUN_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'page.html'), html);
  frameDumps.forEach((f, i) => fs.writeFileSync(path.join(dir, `frame-${i}.html`), `<!-- ${f.url} -->\n` + f.html));
  let inv = null;
  try {
    inv = await page.evaluate(INVENTORY_JS);
    for (const f of page.frames()) {
      if (f === page.mainFrame() || !f.url() || f.url() === 'about:blank') continue;
      try { const fi = await f.evaluate(INVENTORY_JS); inv.frameInventories = inv.frameInventories || []; inv.frameInventories.push(fi); } catch {}
    }
    fs.writeFileSync(path.join(dir, 'elements.json'), JSON.stringify(inv, null, 1));
  } catch (e) { log('inventory failed', e.message); }
  try { await page.screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true, timeout: 15000 }); } catch { try { await page.screenshot({ path: path.join(dir, 'screenshot.png'), timeout: 5000 }); } catch {} }
  const meta = { step, id, ts: new Date().toISOString(), reason, url: page.url(), title: await page.title().catch(() => ''), frames: frameDumps.map(f => f.url), elementCount: inv ? inv.elements.length : null, headings: inv ? inv.headings.slice(0, 10) : [] };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  jl(eventsFile, { kind: 'capture', ...meta });
  log(`step ${id} [${reason}] ${meta.url} :: ${meta.title} (${meta.elementCount} elements)`);
}

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(ROOT, 'profile'), {
    headless: false, executablePath: CHROME, viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--enable-automation'],
    acceptDownloads: true, locale: 'en-IN', timezoneId: 'Asia/Kolkata',
  });
  // MCA's anti-devtools script (disable-devtool) kicks automated browsers back to home; neutralise it.
  await ctx.route(/clientlib-devtool[^/]*\.js/, (r) => { log('blocked', r.request().url()); r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* blocked by recorder */' }); });
  await ctx.addInitScript(INIT_JS);
  await ctx.exposeBinding('__vcfoEvent', async ({ page }, raw) => {
    let ev; try { ev = JSON.parse(raw); } catch { return; }
    ev.ts = new Date().toISOString(); ev.step = step;
    if (ev.kind !== 'mutation') jl(eventsFile, ev);
    if (ev.kind === 'mutation' || ev.kind === 'click' || ev.kind === 'change' || ev.kind === 'submit') {
      setTimeout(() => capture(page, ev.kind).catch(() => {}), ev.kind === 'mutation' ? 0 : 600);
    }
  });

  const wire = (page) => {
    page.on('load', () => capture(page, 'load'));
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) { jl(eventsFile, { kind: 'navigate', ts: new Date().toISOString(), url: f.url() }); setTimeout(() => capture(page, 'navigate'), 800); } });
    page.on('dialog', async (d) => { jl(eventsFile, { kind: 'dialog', ts: new Date().toISOString(), type: d.type(), message: d.message() }); });
    page.on('download', async (d) => { const p = path.join(RUN_DIR, 'downloads', d.suggestedFilename()); fs.mkdirSync(path.dirname(p), { recursive: true }); await d.saveAs(p).catch(() => {}); jl(eventsFile, { kind: 'download', ts: new Date().toISOString(), file: p }); });
    page.on('request', (r) => {
      const t = r.resourceType();
      if (!['xhr', 'fetch', 'document', 'websocket'].includes(t)) return;
      jl(netFile, { kind: 'request', ts: new Date().toISOString(), step, type: t, method: r.method(), url: r.url(), headers: Object.fromEntries(Object.entries(r.headers()).filter(([k]) => !/cookie|authorization/i.test(k))), postData: redactBody(r.postData()) });
    });
    page.on('response', async (r) => {
      const req = r.request(); const t = req.resourceType();
      if (!['xhr', 'fetch', 'document'].includes(t)) return;
      const ct = r.headers()['content-type'] || '';
      let body;
      if (/json|xml|text\/plain/i.test(ct)) { try { body = (await r.text()).slice(0, 200000); } catch {} }
      jl(netFile, { kind: 'response', ts: new Date().toISOString(), step, type: t, method: req.method(), url: r.url(), status: r.status(), contentType: ct, body: redactBody(body) });
    });
    page.on('close', () => log('page closed', page.url()));
  };
  ctx.on('page', (p) => { log('new page', p.url()); wire(p); });

  const page = ctx.pages()[0] || await ctx.newPage();
  wire(page);
  log(`run ${RUN_ID} started; output ${RUN_DIR}`);
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(e => log('goto', e.message));
  await capture(page, 'start');

  // Control channel: lines in cmd.txt -> `goto <url>` | `capture` | `eval <js>`; results to cmd.out.
  const CMD = path.join(ROOT, 'cmd.txt');
  setInterval(async () => {
    if (!fs.existsSync(CMD)) return;
    const lines = fs.readFileSync(CMD, 'utf8').split('\n').filter(Boolean); fs.unlinkSync(CMD);
    const p = ctx.pages().slice(-1)[0]; if (!p) return;
    for (const line of lines) {
      const [cmd, ...rest] = line.split(' '); const arg = rest.join(' ');
      try {
        if (cmd === 'goto') { await p.goto(arg, { waitUntil: 'domcontentloaded', timeout: 60000 }); await capture(p, 'manual'); }
        else if (cmd === 'capture') await capture(p, 'manual');
        else if (cmd === 'wait') await new Promise(r => setTimeout(r, +arg || 1000));
        else if (cmd === 'eval') { const r = await p.evaluate(arg); fs.appendFileSync(path.join(ROOT, 'cmd.out'), JSON.stringify(r) + '\n'); }
        log('cmd ok', line.slice(0, 80));
      } catch (e) { log('cmd failed', line.slice(0, 80), e.message); fs.appendFileSync(path.join(ROOT, 'cmd.out'), 'ERR ' + e.message + '\n'); }
    }
  }, 1000);

  // Periodic safety-net capture (catches canvas/state changes with no mutation event).
  const timer = setInterval(() => { for (const p of ctx.pages()) capture(p, 'tick').catch(() => {}); }, 10000);

  ctx.on('close', () => { clearInterval(timer); log('browser closed; run ended at step', step); eventsFile.end(); netFile.end(); try { fs.unlinkSync(path.join(ROOT, 'recorder.pid')); } catch {} process.exit(0); });
  process.on('SIGINT', () => ctx.close());
  process.on('SIGTERM', () => ctx.close());
})().catch((e) => { log('FATAL', e.stack || e.message); process.exit(1); });
