// Offline test: load a captured page.html, inject the extension scripts with a stub chrome API, run FILL.
const { chromium } = require('/usr/share/nodejs/playwright');
const fs = require('fs'); const path = require('path');
const EXT = path.join(__dirname, '..', 'extension');
const CASES = [
  ['spice-part-a', process.env.HOME + '/mca-capture/steps/2026-09-23T11-35-39-714Z/0019/page.html', 'spice.html'],
  ['spice-part-b', process.env.HOME + '/mca-capture/steps/2026-09-23T12-01-22-114Z/0045/page.html', 'SpicePartB.html'],
  ['agile-pro-s', process.env.HOME + '/mca-capture/steps/2026-09-23T11-35-39-714Z/0045/page.html', 'AgilePro.html'],
  ['inc-33-emoa', process.env.HOME + '/mca-capture/steps/2026-09-23T12-01-22-114Z/0013/page.html', 'INC-33.html'],
];
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' });
  const profile = JSON.parse(fs.readFileSync(path.join(EXT, 'sample/profile.sample.json')));
  for (const [form, file, base] of CASES) {
    const ctx = await b.newContext();
    // serve the captured page under a fake mca.gov.in URL so detectForm() works; block all other resources
    await ctx.route('**/*', (r) => {
      const u = r.request().url();
      if (u.endsWith('/' + base)) return r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '') });
      if (u.includes('/schemas/')) return r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(path.join(EXT, 'schemas', path.basename(u))) });
      return r.fulfill({ status: 204, body: '' });
    });
    const p = await ctx.newPage();
    await p.goto('https://www.mca.gov.in/content/mca/global/en/mca/e-filing/incorporation-change-services/' + base);
    await p.addScriptTag({ content: `window.chrome = { runtime: { getURL: (x) => 'https://www.mca.gov.in/ext/' + x, onMessage: { addListener: (fn) => { window.__handler = fn; } } } };` });
    await p.addScriptTag({ content: fs.readFileSync(path.join(EXT, 'lib/mapping.js'), 'utf8') });
    await p.addScriptTag({ content: fs.readFileSync(path.join(EXT, 'content/filler.js'), 'utf8') });
    const res = await p.evaluate((profile) => new Promise((resolve) => window.__handler({ type: 'FILL', profile }, {}, resolve)), profile);
    const c = {}; res.report.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    console.log(`\n== ${form}: ${JSON.stringify(c)}`);
    res.report.filter((r) => r.status !== 'filled').forEach((r) => console.log(`   [${r.status}] ${r.key}: ${r.msg}`));
    const det = await p.evaluate(() => new Promise((resolve) => window.__handler({ type: 'DETECT' }, {}, resolve)));
    console.log('   detect:', JSON.stringify(det).slice(0, 200));
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
