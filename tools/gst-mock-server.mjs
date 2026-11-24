// Local mock of the GST registration portal (fixtures/gst-portal) and a
// stand-in VCFO Suite, for the offline tests. Loopback only.
//
//   node tools/gst-mock-server.mjs            GST mock on :8765, Suite on :8766
//   import { startMockServers } from './gst-mock-server.mjs'   (tools/e2e-gst.mjs)
//
// The Suite stand-in answers the three routes the extension uses for GST
// (docs/gst-profile-contract.md): the assist profile, attachments by document
// key, and the result post-back, which it records.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = path.join(ROOT, 'fixtures', 'gst-portal');

/** Route (under /registration) to page file, tab label. */
const ROUTES = [
  ['/registration/', 'part-a', null],
  ['/registration/verify', 'verify-otp', null],
  ['/registration/auth/newappl/business', 'business', 'Business Details'],
  ['/registration/auth/newappl/promoters', 'promoters', 'Promoter / Partners'],
  ['/registration/auth/newappl/authsignatory', 'authsignatory', 'Authorized Signatory'],
  ['/registration/auth/newappl/authrepresentative', 'authrepresentative', 'Authorized Representative'],
  ['/registration/auth/newappl/business/place', 'place', 'Principal Place of Business'],
  ['/registration/auth/newappl/business/addlplace', 'addlplace', 'Additional Places of Business'],
  ['/registration/auth/newappl/goodsservices', 'goodsservices', 'Goods and Services'],
  ['/registration/auth/newappl/bankaccounts', 'bankaccounts', 'Bank Accounts'],
  ['/registration/auth/newappl/statespecific', 'statespecific', 'State Specific Information'],
  ['/registration/auth/newappl/aadhar', 'aadhar', 'Aadhaar Authentication'],
  ['/registration/auth/newappl/verify', 'verify', 'Verification'],
  ['/registration/auth/newappl/acknowledgement', 'acknowledgement', null],
];

/**
 * @param {string} name
 * @param {string} route
 * @returns {string}
 */
function layout(name, route) {
  const body = fs.readFileSync(path.join(MOCK, 'pages', `${name}.html`), 'utf8');
  const tabs = route.startsWith('/registration/auth/newappl/') && name !== 'acknowledgement'
    ? `<nav class="tabs">${ROUTES.filter((r) => r[2]).map(([r, , label]) => `<a href="${r}"${r === route ? ' class="active"' : ''}>${label}</a>`).join('')}</nav>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="/registration/">
<title>Goods and Services Tax (mock)</title><link rel="stylesheet" href="/mock.css"></head>
<body data-page="${name}"><header>Goods and Services Tax — local mock for VCFO Assist tests</header>${tabs}<main>${body}</main>
<script src="/mock.js"></script></body></html>`;
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || 'null')); } catch { resolve(null); }
    });
  });
}

/**
 * @param {{ gstPort?: number, suitePort?: number, host?: string }} [opts]
 */
export async function startMockServers(opts = {}) {
  const host = opts.host ?? '127.0.0.1';
  /** @type {any[]} */ const events = [];
  /** @type {any[]} */ const saves = [];
  /** @type {any[]} */ const suiteCalls = [];
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'gst-engagement.json'), 'utf8'));

  const gst = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (url.pathname === '/mock.css') return send(200, 'text/css', fs.readFileSync(path.join(MOCK, 'mock.css')));
    if (url.pathname === '/mock.js') return send(200, 'text/javascript', fs.readFileSync(path.join(MOCK, 'mock.js')));
    if (url.pathname === '/__mock/event' && req.method === 'POST') { events.push(await readJson(req)); return send(204, 'text/plain', ''); }
    if (url.pathname === '/__mock/save' && req.method === 'POST') { saves.push(await readJson(req)); return send(204, 'text/plain', ''); }
    if (url.pathname === '/__mock/log') return send(200, 'application/json', JSON.stringify({ events, saves }));
    const p = url.pathname === '/registration' ? '/registration/' : url.pathname.replace(/\/$/, '') || '/';
    const route = ROUTES.find(([r]) => r === p || (r === '/registration/' && p === '/registration'));
    if (route) return send(200, 'text/html; charset=utf-8', layout(route[1], route[0]));
    if (p === '/' || p === '') { res.writeHead(302, { location: '/registration/' }); return res.end(); }
    return send(404, 'text/plain', 'not in the mock');
  });

  const suite = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://suite');
    const json = (status, o) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
    if (!url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>VCFO Suite (stand-in)</title><h1>Example Fixture Ventures Private Limited</h1>');
    }
    const body = req.method === 'POST' || req.method === 'PATCH' ? await readJson(req) : null;
    suiteCalls.push({ method: req.method, path: url.pathname, search: url.search, body });
    if (/\/api\/engagements\/[^/]+\/assist-profile$/.test(url.pathname)) {
      if (url.searchParams.get('form') !== 'gst-reg-01') return json(400, { ok: false, error: 'form must be gst-reg-01' });
      return json(200, fixture);
    }
    const att = /\/api\/assist\/engagements\/[^/]+\/attachments\/([^/]+)$/.exec(url.pathname);
    if (att) {
      const doc = fixture.documents.find((d) => d.key === decodeURIComponent(att[1]));
      if (!doc) return json(404, { ok: false, error: 'no such document' });
      return json(200, { ok: true, fileName: doc.fileName, contentType: doc.contentType, base64: doc.url.split(',')[1] });
    }
    if (/\/api\/assist\/engagements\/[^/]+\/result$/.test(url.pathname) && req.method === 'POST') {
      return json(200, { ok: true, recorded: true });
    }
    return json(200, { ok: true });
  });

  await new Promise((r) => gst.listen(opts.gstPort ?? 0, host, () => r(undefined)));
  await new Promise((r) => suite.listen(opts.suitePort ?? 0, host, () => r(undefined)));
  const port = (s) => /** @type {import('node:net').AddressInfo} */ (s.address()).port;
  return {
    gstOrigin: `http://${host}:${port(gst)}`,
    suiteOrigin: `http://${host}:${port(suite)}`,
    events, saves, suiteCalls,
    close: () => Promise.all([new Promise((r) => gst.close(r)), new Promise((r) => suite.close(r))]),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startMockServers({ gstPort: 8765, suitePort: 8766 });
  console.log(`GST mock: ${s.gstOrigin}/registration/   Suite stand-in: ${s.suiteOrigin}`);
}
