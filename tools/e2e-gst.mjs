// Offline end-to-end test of GST REG-01 in real Chromium, against the local
// mock portal (fixtures/gst-portal) and a stand-in Suite, both on loopback
// (tools/gst-mock-server.mjs). Every other request is aborted and name lookups
// fail, so nothing reaches gst.gov.in. The test plays the person: it presses
// the buttons the extension must never press (Save & Continue, ADD NEW, Add,
// SUBMIT WITH EVC) with trusted Playwright clicks, and proves from the mock's
// click log that the extension pressed none of them.
//
// Usage: node tools/e2e-gst.mjs   (Playwright Chromium from ../vcfo-suite/node_modules)
// Prints check results and counts only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMockServers } from './gst-mock-server.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, '..', 'vcfo-suite', 'package.json'));
const { chromium } = require('playwright');

const mock = await startMockServers();
const GST = mock.gstOrigin;
const SUITE = mock.suiteOrigin;
const ENGAGEMENT = 'example-fixture-ventures';
const ARN = 'AA3611260012345';

let failed = 0;
/** @param {string} label @param {boolean} ok @param {string} [detail] */
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The worker takes panel messages only from extension pages that are not tabs;
// a headless test can open the panel only as a tab. Test a copy with that one
// check relaxed for extension pages, and with loopback host permission added.
const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcfo-assist-gst-copy-'));
for (const entry of ['manifest.json', 'src', 'recipes', 'fieldmaps', 'assets', 'fixtures']) {
  if (fs.existsSync(path.join(ROOT, entry))) fs.cpSync(path.join(ROOT, entry), path.join(copyDir, entry), { recursive: true });
}
const workerFile = path.join(copyDir, 'src', 'worker.js');
const workerSource = fs.readFileSync(workerFile, 'utf8');
const tabLine = '    if (sender.tab) {';
if (!workerSource.includes(tabLine)) throw new Error('The worker sender check has changed; update this test.');
fs.writeFileSync(workerFile, workerSource.replace(tabLine, "    if (sender.tab && !String(sender.url ?? '').startsWith('chrome-extension://')) {"));
const manifestFile = path.join(copyDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
manifest.host_permissions.push('http://127.0.0.1/*');
fs.writeFileSync(manifestFile, JSON.stringify(manifest));

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcfo-assist-gst-profile-'));
const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${copyDir}`, `--load-extension=${copyDir}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  ],
});
let blocked = 0;
await context.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (u.protocol === 'chrome-extension:' || u.protocol === 'data:' || u.hostname === '127.0.0.1') return route.continue();
  blocked += 1;
  return route.abort();
});

let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
const extensionId = new URL(worker.url()).host;
const panel = await context.newPage();
await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/panel.html`);
/** @param {Record<string, unknown>} m @returns {Promise<any>} */
const ask = (m) => panel.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
const state = async () => (await ask({ type: 'va.getState' })).value;

// Development retargeting: devMode on, the mock origin named. Only an unpacked build honours it.
await ask({ type: 'va.setDevMode', devMode: true });
await panel.evaluate((o) => chrome.storage.local.set({ 'va.pref.mockOrigin': o }), GST);
const set = await ask({ type: 'va.setSuiteOrigin', origin: SUITE });
check('Suite origin accepted', set.ok, set.ok ? '' : set.error.message);

// Suite page: the hook marks it and relays Suite's start request.
const suitePage = await context.newPage();
await suitePage.goto(`${SUITE}/app/intern/projects/${ENGAGEMENT}?assist=gst-reg-01`);
let marked = '';
for (let i = 0; i < 20 && !marked; i += 1) {
  marked = await suitePage.evaluate(() => document.documentElement.dataset.vcfoAssist ?? '');
  if (!marked) await sleep(250);
}
check('Suite page carries data-vcfo-assist (installed marker)', marked !== '', marked);
await suitePage.evaluate((id) => window.postMessage({ source: 'vcfo-suite', type: 'vcfo-assist:start', form: 'gst-reg-01', engagementId: id }, location.origin), ENGAGEMENT);
await sleep(500);
const pending = (await state()).pendingStart;
check('Suite start request preselects GST Part A', pending?.formId === 'gst-reg-01-part-a', pending?.formId ?? 'none');

/** Wait for the run to leave "running". */
async function settle(ms = 120000) {
  const until = Date.now() + ms;
  let run = null;
  while (Date.now() < until) {
    run = (await state()).run;
    if (run && run.status !== 'running') return run;
    await sleep(400);
  }
  return run;
}
/** @returns {import('playwright').Page | undefined} */
const gstPage = () => context.pages().find((p) => p.url().startsWith(GST));
const untrustedClicks = () => mock.events.filter((e) => e.kind === 'click' && e.trusted === false);

/* ---------------------------------------------------------------- Part A */
const a = await ask({ type: 'va.startPartA', formId: 'gst-reg-01-part-a' });
check('Part A: profile loads from Suite and the form is prepared', a.ok, a.ok ? '' : a.error.message);
check('Part A: profile asked for with form=gst-reg-01', mock.suiteCalls.some((c) => c.path.endsWith('/assist-profile') && c.search === '?form=gst-reg-01'));
const prepared = (await state()).prepared;
check('Part A: the panel warns that GST is mock-only', (prepared?.warnings ?? []).some((w) => /mock-only/.test(w)));
for (let i = 0; i < 30 && !gstPage(); i += 1) await sleep(300);
await sleep(800);
const runA = await ask({ type: 'va.startRun', tabId: a.value.mcaTabId });
check('Part A: run starts on the mock origin', runA.ok, runA.ok ? '' : runA.error.message);
let run = await settle();
check('Part A: run halts for the person (captcha, PROCEED, OTP)', run?.status === 'halted', `${run?.status} ${run?.error?.message ?? ''}`);
console.log(`  Part A written=${run?.fieldsWritten} checked=${run?.diff?.checked} mismatches=${run?.diff?.mismatches.length}`);
let p = gstPage();
const partA = await p.evaluate(() => ({
  type: document.querySelector('#applnType').value, st: document.querySelector('#applnState').value,
  dt: document.querySelector('#applnDistr').value, pan: document.querySelector('#pan_card').value,
  email: document.querySelector('#email').value, mobile: document.querySelector('#mobile').value,
  captcha: document.querySelector('#captcha').value, url: location.pathname,
}));
check('Part A: type, state and the late-loading district are chosen', partA.type === 'APLRG' && partA.st === '36' && partA.dt === 'TGHYD');
check('Part A: PAN, email and mobile are filled from the profile', partA.pan === 'AAACE0000F' && partA.email === 'accounts@example.test' && partA.mobile === '9000000000');
check('Part A: captcha left empty and still on the form (PROCEED not pressed)', partA.captcha === '' && partA.url === '/registration/');
check('Part A: no button or link was clicked by the extension', untrustedClicks().length === 0, JSON.stringify(untrustedClicks()));
await ask({ type: 'va.abortRun' });
await sleep(300);

/* ---------------------------------------------------------------- Part B */
// The person logs in with the TRN, clears the OTP and opens the saved application.
await p.goto(`${GST}/registration/auth/newappl/business`);
const b = await ask({ type: 'va.startPartA', formId: 'gst-reg-01-part-b' });
check('Part B: prepared from the same profile', b.ok, b.ok ? '' : b.error.message);
const runB = await ask({ type: 'va.startRun', tabId: b.value?.mcaTabId ?? -1 });
check('Part B: run starts', runB.ok, runB.ok ? '' : runB.error.message);

/** Click a person's button (trusted) and wait for the page that follows. */
async function personPresses(selector) {
  const page = gstPage();
  const nav = selector.includes('submit') ? page.waitForURL((u) => true, { waitUntil: 'load' }).catch(() => undefined) : null;
  await page.click(selector);
  if (nav) await nav;
  await sleep(400);
}
const SAVE = 'button[type=submit]';
let gates = 0;
for (;;) {
  run = await settle();
  if (!run || run.status !== 'paused' || run.pause?.kind !== 'humanGate') break;
  gates += 1;
  const msg = String(run.pause.message);
  const where = new URL(gstPage().url()).pathname;
  if (/click Add on the portal/.test(msg)) await personPresses('#addexist');
  else if (/promoter (\d+) of (\d+)/.test(msg)) {
    const [, n, count] = /promoter (\d+) of (\d+)/.exec(msg);
    await personPresses(n === count ? SAVE : '#addnew');
  } else if (where.endsWith('/authsignatory')) { await personPresses(SAVE); await personPresses(SAVE); }
  else if (where.endsWith('/goodsservices')) { await personPresses(SAVE); await personPresses(SAVE); }
  else if (where.endsWith('/statespecific')) { await personPresses(SAVE); await personPresses(SAVE); }
  else await personPresses(SAVE);
  const c = await ask({ type: 'va.continueGate' });
  if (!c.ok) { check(`gate ${gates} continues`, false, c.error.message); break; }
}
check('Part B: run halts at Verification for the signatory', run?.status === 'halted', `${run?.status} ${run?.error?.class ?? ''} ${String(run?.error?.message ?? '').slice(0, 300)}`);
console.log(`  Part B gates=${gates} written=${run?.fieldsWritten} checked=${run?.diff?.checked} matched=${run?.diff?.matched} mismatches=${run?.diff?.mismatches.length}`);
for (const m of run?.diff?.mismatches ?? []) console.log(`    mismatch ${m.key}: ${m.reason}`);

const saved = (page) => mock.saves.filter((s) => s.page === page);
const bd = saved('business').at(-1)?.values ?? {};
check('Business: constitution, reason and dates saved', bd.bd_ConstBuss === 'Private Limited Company' && bd.bd_rsl === 'Voluntary Basis' && bd.bd_cmbz === '01/11/2026');
check('Business: certificate of incorporation uploaded after its type was chosen', bd['bd_upload:files'] === 'certificate-of-incorporation.pdf' && bd.bd_up_type === 'Certificate of Incorporation');
check('Business: existing registration added (by the person pressing Add)', /Corporate Identity Number/.test(bd.existing_added ?? ''));
const pr = saved('promoters').map((s) => s.values);
check('Promoters: two promoters saved (repeat group)', pr.length === 2 && pr[0].fnm === 'Asha' && pr[1].fnm === 'Kiran', pr.map((v) => v.fnm).join(','));
check('Promoters: gender radio, DIN, PAN and DOB per row', pr[0]?.pd_gd === 'F' && pr[1]?.pd_gd === 'M' && pr[1]?.din === '00000002' && pr[1]?.pan === 'ABCPT0002B' && pr[0]?.dob === '14/02/1985');
check('Promoters: photo uploaded for each', pr[0]?.['pd_upload:files'] === 'asha-fixture.jpg' && pr[1]?.['pd_upload:files'] === 'kiran-example.jpg');
check('Promoters: Aadhaar number never typed', pr.every((v) => (v.uid ?? '') === ''));
const as = saved('authsignatory').at(-1)?.values ?? {};
check('Signatory: details and board resolution uploaded', as.fnm === 'Asha' && as.em === 'director1@example.test' && as['as_upload_sign:files'] === 'board-resolution.pdf');
const pp = saved('place').at(-1)?.values ?? {};
check('Principal place: address, contact and jurisdiction (late options)', pp.pncd === '500081' && pp.bp_email === 'office@example.test' && pp.comcd === 'HYDERABAD');
check('Principal place: custom possession drop-down chosen', pp.bp_buss_poss_btn === 'Rented/Leased', pp.bp_buss_poss_btn);
check('Principal place: activities ticked by label', pp.bp_ck_7 === '7' && pp.bp_ck_5 === '5' && Object.keys(pp).filter((k) => k.startsWith('bp_ck_')).length === 2);
check('Principal place: rent agreement uploaded', pp['bp_upload:files'] === 'rent-agreement.pdf');
const gs = saved('goodsservices').at(-1)?.values ?? {};
check('Goods and services: HSN and two SAC rows added through the search box', gs.hsn_added === '8471' && gs.sac_added === '998314,998313', `${gs.hsn_added} / ${gs.sac_added}`);
check('State specific: professional tax EC saved', saved('statespecific').at(-1)?.values?.ec_tax === 'PTEC0000001');
p = gstPage();
const vf = await p.evaluate(() => ({
  sign: document.querySelector('#authsign').selectedOptions[0]?.textContent, place: document.querySelector('#veriPlace').value,
  declared: document.querySelector('#authveri').checked, url: location.pathname,
}));
check('Verification: signatory and place filled, declaration left for the signatory', vf.sign === 'Asha Fixture' && vf.place === 'Hyderabad' && vf.declared === false && vf.url.endsWith('/verify'));

const allowed = (e) => e.id === 'bp_buss_poss_btn' || (e.tag === 'A' && e.id === '');
const bad = untrustedClicks().filter((e) => !allowed(e));
check('The extension pressed no Save & Continue, ADD NEW, Add, PROCEED or Submit', bad.length === 0, JSON.stringify(bad));
check('Every form submit came from a person', mock.events.filter((e) => e.kind === 'submit').every((e) => e.trusted === true));

/* ------------------------------------------------------------- ARN back */
// The signatory ticks the declaration and submits with EVC (the mock skips the OTP).
await p.check('#authveri');
await p.click('#btn_evc');
await p.waitForURL(/acknowledgement/);
check('Mock success page reached by the person', true);
await ask({ type: 'va.markSubmitted' });
const cap = await ask({ type: 'va.captureResult', tabId: b.value.mcaTabId });
check('ARN read from the success page', cap.ok && cap.value.result.srn === ARN, cap.ok ? cap.value.result.srn : cap.error.message);
const post = await ask({ type: 'va.postResult' });
check('Result posted to Suite', post.ok, post.ok ? '' : post.error.message);
const posted = mock.suiteCalls.find((c) => c.method === 'POST' && /\/api\/assist\/engagements\/[^/]+\/result$/.test(c.path));
check('Result body: form gst-reg-01, ARN, ARN date, reg-4 subject', posted?.body?.form === 'gst-reg-01' && posted?.body?.arn === ARN
  && posted?.body?.arnDate === '25/11/2026' && posted?.body?.subjectKind === 'registration' && posted?.body?.subjectKey === 'reg-4',
JSON.stringify({ form: posted?.body?.form, arn: posted?.body?.arn, arnDate: posted?.body?.arnDate, subjectKey: posted?.body?.subjectKey }));
check('Attachments asked of Suite by document key', mock.suiteCalls.some((c) => c.path.endsWith('/attachments/promoter.2.photo')));

console.log(`requests to the mock: ${mock.events.length} events, ${mock.saves.length} saves; Suite calls ${mock.suiteCalls.length}; other requests blocked: ${blocked}`);
await context.close();
await mock.close();
fs.rmSync(profileDir, { recursive: true, force: true });
fs.rmSync(copyDir, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
