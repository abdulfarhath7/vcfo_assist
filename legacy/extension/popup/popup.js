/* vCFO Assist popup: holds the client profile, talks to the content script on the active MCA tab. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const log = (msg, cls) => { const el = $('log'); const line = document.createElement('div'); if (cls) line.className = cls; line.textContent = msg; el.appendChild(line); el.scrollTop = el.scrollHeight; };
  const setStatus = (text, cls) => { const s = $('status'); s.textContent = text; s.className = 'pill ' + (cls || ''); };

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function send(msg) {
    const tab = await activeTab();
    if (!tab || !/^https:\/\/www\.mca\.gov\.in\//.test(tab.url || '')) throw new Error('Active tab is not www.mca.gov.in');
    try {
      return await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e) {
      // content script not injected yet (extension reloaded after page load) — inject once and retry
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/mapping.js', 'content/filler.js'] });
      return chrome.tabs.sendMessage(tab.id, msg);
    }
  }

  function readProfile() {
    const txt = $('profile').value.trim();
    if (!txt) throw new Error('Profile is empty');
    try { return JSON.parse(txt); } catch (e) { throw new Error('Profile JSON invalid: ' + e.message); }
  }

  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function detect() {
    try {
      const d = await send({ type: 'DETECT' });
      if (d.error) throw new Error(d.error);
      if (!d.formKey) { setStatus('not a known form', 'bad'); $('detectInfo').textContent = `Page: ${d.title || d.url}. Not a mapped SPICe+ form. "Discover fields" still works on any AEM form page.`; return; }
      setStatus(d.formKey, 'ok');
      $('detectInfo').innerHTML = `<b>${d.formKey}</b> — ${d.presentFields}/${d.schemaFields} schema fields found on page, ${d.liveFields} live fields` + (d.wizard.length ? `<br><span class="small">Sections: ${d.wizard.join(' › ')}</span>` : '');
    } catch (e) { setStatus('no MCA tab', 'bad'); $('detectInfo').textContent = e.message; }
  }

  $('save').onclick = async () => { try { const p = readProfile(); await chrome.storage.local.set({ profile: p }); log('profile saved', 'ok'); } catch (e) { log(e.message, 'bad'); } };
  $('loadSample').onclick = async () => { const r = await fetch(chrome.runtime.getURL('sample/profile.sample.json')); $('profile').value = JSON.stringify(await r.json(), null, 2); log('sample profile loaded (edit before use)'); };
  $('importBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = async (ev) => { const f = ev.target.files[0]; if (f) { $('profile').value = await f.text(); log('imported ' + f.name); } };
  $('clear').onclick = () => { $('log').textContent = ''; };

  $('preview').onclick = async () => {
    try {
      const r = await send({ type: 'PREVIEW', profile: readProfile() });
      if (r.error) throw new Error(r.error);
      log(`${r.formKey}: ${r.items.length} values would be filled`);
      r.items.forEach((i) => log(`  ${i.key}${i.instance ? '#' + (i.instance + 1) : ''} = ${i.value}`));
    } catch (e) { log(e.message, 'bad'); }
  };

  $('fill').onclick = async () => {
    try {
      const profile = readProfile();
      await chrome.storage.local.set({ profile });
      log('filling…');
      const r = await send({ type: 'FILL', profile });
      if (r.error) throw new Error(r.error);
      const c = {};
      r.report.forEach((x) => { c[x.status] = (c[x.status] || 0) + 1; const cls = x.status === 'filled' ? 'ok' : /notfound|nomatch/.test(x.status) ? 'bad' : 'warn'; log(`  [${x.status}] ${x.key}: ${x.msg}${x.note ? ' — ' + x.note : ''}`, cls); });
      log(`${r.formKey}: ` + Object.entries(c).map(([k, v]) => `${k}=${v}`).join(', '), 'ok');
    } catch (e) { log(e.message, 'bad'); }
  };

  $('scan').onclick = async () => {
    try {
      const r = await send({ type: 'SCAN' });
      if (r.error) throw new Error(r.error);
      log(`${r.formKey || 'page'}: ${r.fields.length} fields with values`);
      r.fields.forEach((f) => log(`  ${f.key} (${f.label || ''}) = ${f.value}`));
      download(`mca-scan-${r.formKey || 'page'}.json`, r);
    } catch (e) { log(e.message, 'bad'); }
  };

  $('discover').onclick = async () => {
    try {
      const r = await send({ type: 'DISCOVER' });
      if (r.error) throw new Error(r.error);
      const vis = r.fields.filter((f) => f.visible).length;
      log(`${r.formKey || 'page'}: ${r.fields.length} fields discovered (${vis} visible). Downloaded JSON — merge into schemas/ to extend mapping.`, 'ok');
      download(`mca-discover-${r.formKey || 'page'}-${Date.now()}.json`, r);
    } catch (e) { log(e.message, 'bad'); }
  };

  chrome.storage.local.get('profile').then(({ profile }) => { if (profile) $('profile').value = JSON.stringify(profile, null, 2); });
  detect();
})();
