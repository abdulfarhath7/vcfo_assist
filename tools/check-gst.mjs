// Fast checks of the GST REG-01 pack without a browser: the generated field
// maps match their generator, the recipes load and expand for the fixture,
// retargeting to the mock happens only in development with a loopback origin,
// and the guard refuses what it must. Run: node tools/check-gst.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
/** @param {string} label @param {boolean} ok @param {string} [detail] */
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed += 1;
}

let mockPref = '';
let unpacked = true;
globalThis.chrome = /** @type {any} */ ({
  runtime: { getManifest: () => (unpacked ? { version: 'test' } : { version: 'test', update_url: 'https://clients2.google.com/service/update2/crx' }), getURL: (p) => `pkg:${p}` },
  storage: { local: { get: async () => ({ 'va.pref.mockOrigin': mockPref }) }, session: { get: async () => ({}) } },
});
globalThis.fetch = /** @type {any} */ (async (u) => {
  const p = path.join(ROOT, String(u).slice(4));
  if (!fs.existsSync(p)) return { ok: false };
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
});

try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-gst-fieldmaps.mjs'), '--check'], { stdio: 'pipe' });
  check('field maps match tools/build-gst-fieldmaps.mjs', true);
} catch (e) {
  check('field maps match tools/build-gst-fieldmaps.mjs', false, String(e.stderr ?? e).trim());
}

const { loadFormFor } = await import(path.join(ROOT, 'src/engine/loader.js'));
const { validateProfileResponse, payloadFromProfile } = await import(path.join(ROOT, 'src/suite/profile.js'));
const { checkNavigateTarget } = await import(path.join(ROOT, 'src/engine/guard.js'));
const { CREDENTIAL } = await import(path.join(ROOT, 'src/shared/constants.js'));

const body = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/gst-engagement.json'), 'utf8'));
const v = validateProfileResponse(body, 'fixture');
check('fixture profile is valid', v.ok, v.ok ? '' : v.error.message);
const payload = payloadFromProfile(v.value, { formId: 'gst-reg-01-part-b', engagementId: 'fixture' });

const live = await loadFormFor('gst-reg-01-part-b', false, payload);
check('Part B loads (production)', live.ok, live.ok ? '' : live.error.message);
if (live.ok) {
  const { recipe, fieldMap } = live.value;
  check('production keeps the live origin', recipe.origin === 'https://reg.gst.gov.in' && fieldMap.origin === 'https://reg.gst.gov.in');
  check('Part B is mock-only', recipe.legalStatus === 'mock-only');
  const sections = recipe.steps.filter((s) => s.op === 'fillGroup').map((s) => s.section);
  check('two promoters expanded', sections.includes('promoter@1') && sections.includes('promoter@2') && !sections.includes('promoter@3'));
  check('no forEach left after expansion', !recipe.steps.some((s) => s.op === 'forEach'));
  check('promoter 2 reads promoters.2.*', fieldMap.sections['promoter@2'].every((f) => f.sourceField === null || !f.sourceField.includes('{n}')));
  check('no step clicks anything', !recipe.steps.some((s) => s.op === 'click'));
}

mockPref = 'http://127.0.0.1:8765';
const dev = await loadFormFor('gst-reg-01-part-a', true, payload);
check('dev + loopback pref retargets to the mock', dev.ok && dev.value.recipe.origin === mockPref && dev.value.recipe.steps[0].url === `${mockPref}/registration/`);
const notDev = await loadFormFor('gst-reg-01-part-a', false, payload);
check('the pref is ignored without development mode', notDev.ok && notDev.value.recipe.origin === 'https://reg.gst.gov.in');
unpacked = false;
const packed = await loadFormFor('gst-reg-01-part-a', true, payload);
check('the pref is ignored in a store build', packed.ok && packed.value.recipe.origin === 'https://reg.gst.gov.in');
unpacked = true;
mockPref = 'https://evil.example';
const remote = await loadFormFor('gst-reg-01-part-a', true, payload);
check('a non-loopback pref is ignored', remote.ok && remote.value.recipe.origin === 'https://reg.gst.gov.in');

check('navigate refuses another origin', !checkNavigateTarget('https://example.com/').ok);
check('navigate refuses a loopback origin that is not the run\'s mock', !checkNavigateTarget('http://127.0.0.1:9999/', '', 'http://127.0.0.1:8765').ok);
check('navigate allows the GST portal', checkNavigateTarget('https://reg.gst.gov.in/registration/').ok);
const cred = new RegExp(CREDENTIAL.pattern, CREDENTIAL.flags);
check('credential set covers TRN, captcha, OTP, Aadhaar uid', ['#trnno', '#captcha', '#mobile_otp', '#uid', 'evc'].every((s) => cred.test(s)));
check('credential set leaves the GST fields alone', !['#pan_card', '#bnm', '#mbno', '#pd_email', '#din'].some((s) => cred.test(s)));

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
