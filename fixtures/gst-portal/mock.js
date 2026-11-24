// Behaviour for the mock GST portal pages. Plain JavaScript; it imitates only
// what VCFO Assist depends on: options that load late, PIN look-ups, the
// custom possession drop-down, the upload directive, the HSN/SAC search box
// and the Save & Continue / ADD NEW / Submit buttons (which only a person
// presses). Every click and submit is reported to the server with isTrusted.

(() => {
  'use strict';
  const page = document.body.dataset.page || '';

  const report = (kind, el) => {
    const body = JSON.stringify({
      kind, page, trusted: kind === 'submit' ? lastClickTrusted : undefined,
      id: el && el.id || '', tag: el && el.tagName || '', type: el && el.getAttribute && (el.getAttribute('type') || '') || '',
      text: el ? (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '',
    });
    navigator.sendBeacon('/__mock/event', new Blob([body], { type: 'application/json' }));
  };
  let lastClickTrusted = true;
  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest('button, a, input[type=submit], input[type=button]') : null;
    if (!el) return;
    lastClickTrusted = e.isTrusted;
    const body = JSON.stringify({
      kind: 'click', page, trusted: e.isTrusted, id: el.id || '', tag: el.tagName,
      type: el.getAttribute('type') || '', text: (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    });
    navigator.sendBeacon('/__mock/event', new Blob([body], { type: 'application/json' }));
  }, true);

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const later = (ms, fn) => setTimeout(fn, ms);

  /** Values a person would have saved on this tab. */
  const formValues = (form) => {
    const out = {};
    for (const el of $$('input, select', form)) {
      if (!el.id && !el.name) continue;
      const k = el.type === 'radio' ? (el.name || el.id) : (el.id || el.name);
      if (el.type === 'file') out[k] = el.files && el.files[0] ? el.files[0].name : '';
      else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) out[k] = el.value || 'on'; }
      else if (el.tagName === 'SELECT') out[k] = el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '';
      else out[k] = el.value;
    }
    for (const b of $$('.natpos-dropdown-toggle', form)) out[b.id || 'possession'] = b.textContent.trim();
    for (const t of $$('table.added', form)) out[t.id] = $$('tbody tr', t).map((r) => r.cells[0].textContent.trim()).join(',');
    for (const u of $$('.upload', form)) out[`${u.id}:files`] = $$('li', u).map((li) => li.textContent.trim()).join(',');
    return out;
  };
  const save = (form, action) => fetch('/__mock/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page, action, values: formValues(form) }),
  });

  // Save & Continue (type=submit) and ADD NEW: a person's buttons.
  for (const form of $$('form[data-next]')) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      report('submit', e.submitter || null);
      await save(form, 'save');
      let next = form.dataset.next;
      if (form.dataset.nextIf && $(form.dataset.nextIf) && $(form.dataset.nextIf).checked) next = form.dataset.nextIfTo;
      location.href = next;
    });
  }
  for (const btn of $$('[data-add-new]')) {
    btn.addEventListener('click', async () => {
      const form = btn.closest('form');
      await save(form, 'add');
      form.reset();
      for (const u of $$('.upload', form)) { $$('li', u).forEach((li) => li.remove()); const i = $('input[type=file]', u); if (i) { i.value = ''; i.disabled = Boolean(u.dataset.typeSelect); } }
      for (const t of $$('.natpos-dropdown-toggle', form)) t.textContent = 'Select';
      $('#fnm, #pncd, input[type=text]', form)?.focus();
    });
  }

  // Part A: New Registration / TRN, and districts that load after the state.
  const typ = () => $$('input[name=typ]').find((r) => r.checked)?.value;
  const showTyp = () => {
    if ($('#newreg')) $('#newreg').hidden = typ() !== 'N';
    if ($('#trnreg')) $('#trnreg').hidden = typ() !== 'T';
  };
  $$('input[name=typ]').forEach((r) => r.addEventListener('change', showTyp));
  showTyp();
  const DISTRICTS = {
    36: [['TGHYD', 'Hyderabad'], ['TGRAN', 'Rangareddy'], ['TGMED', 'Medchal-Malkajgiri']],
    29: [['KABLU', 'Bengaluru Urban'], ['KAMYS', 'Mysuru']],
    27: [['MHMUM', 'Mumbai'], ['MHPUN', 'Pune']],
  };
  $('#applnState')?.addEventListener('change', (e) => {
    const d = $('#applnDistr');
    d.innerHTML = '<option value="">Select</option>';
    later(400, () => {
      for (const [v, t] of DISTRICTS[e.target.value] || []) d.append(new Option(t, v));
    });
  });

  // PIN look-up: fills state and the jurisdiction lists a moment later.
  for (const pin of $$('#pncd')) {
    pin.addEventListener('change', () => {
      if (pin.value.length !== 6) return;
      later(300, () => {
        const st = $('#pd_state, #as_state');
        if (st && !st.value) st.value = 'Telangana';
        const sel = (id, opts) => { const s = $(id); if (!s) return; s.innerHTML = '<option value="">Select</option>'; for (const o of opts) s.append(new Option(o, o)); };
        sel('#stj', ['Madhapur Circle', 'Begumpet Circle']);
        sel('#comcd', ['HYDERABAD', 'RANGAREDDY']);
      });
    });
  }
  $('#comcd')?.addEventListener('change', () => later(300, () => {
    const s = $('#divcd'); s.innerHTML = '<option value="">Select</option>'; s.append(new Option('MADHAPUR', 'MADHAPUR'));
  }));
  $('#divcd')?.addEventListener('change', () => later(300, () => {
    const s = $('#rgcd'); s.innerHTML = '<option value="">Select</option>'; s.append(new Option('MADHAPUR-I', 'MADHAPUR-I'));
  }));

  // Custom "Nature of possession of premises" drop-down (not a <select>).
  for (const btn of $$('.natpos-dropdown-toggle')) {
    const menu = btn.parentElement.querySelector('.natpos-dropdown-menu');
    btn.addEventListener('click', (e) => { e.preventDefault(); menu.classList.toggle('open'); });
    for (const a of $$('a.natpos-item', menu)) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        btn.textContent = a.textContent.trim();
        const hidden = btn.parentElement.querySelector('input[type=hidden]');
        if (hidden) hidden.value = a.dataset.code || '';
        menu.classList.remove('open');
      });
    }
  }

  // Upload directive: disabled until a document type is chosen; the portal's caps.
  const LIMITS = { PHOT: [100, ['image/jpeg']], CINC: [1024, ['application/pdf', 'image/jpeg']], RLAT: [2000, ['application/pdf', 'image/jpeg']], ELCB: [500, ['application/pdf', 'image/jpeg']], CRBC: [1024, ['application/pdf', 'image/jpeg']], LOAU: [1024, ['application/pdf', 'image/jpeg']] };
  for (const box of $$('.upload')) {
    const input = $('input[type=file]', box);
    const typeSel = box.dataset.typeSelect ? $(box.dataset.typeSelect) : null;
    const fixed = box.dataset.docType || '';
    const code = () => fixed || (typeSel ? typeSel.value : '');
    if (typeSel) {
      input.disabled = !typeSel.value;
      typeSel.addEventListener('change', () => { input.disabled = !typeSel.value; });
    }
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      const err = $('.err', box);
      err.textContent = '';
      if (!f) return;
      const [kb, types] = LIMITS[code()] || [1024, ['application/pdf', 'image/jpeg']];
      if (f.size > kb * 1024) { err.textContent = `File size should be less than ${kb} KB`; return; }
      if (!types.includes(f.type)) { err.textContent = 'Invalid file type'; return; }
      const li = document.createElement('li');
      li.textContent = f.name;
      $('ul', box).append(li);
    });
  }

  // HSN / SAC search box: rows appear after two characters; picking one adds a row and clears the box.
  const CODES = {
    hsn: [['8471', 'AUTOMATIC DATA PROCESSING MACHINES AND UNITS THEREOF'], ['8473', 'PARTS AND ACCESSORIES FOR MACHINES OF HEADING 8470 TO 8472'], ['4901', 'PRINTED BOOKS, BROCHURES, LEAFLETS']],
    sac: [['998313', 'Information technology (IT) consulting and support services'], ['998314', 'Information technology (IT) design and development services'], ['998315', 'Hosting and information technology (IT) infrastructure provisioning services']],
  };
  for (const input of $$('input[data-ac]')) {
    const kind = input.dataset.ac;
    const wrap = input.closest('.ac');
    const table = $(input.dataset.table);
    let drop = null;
    const close = () => { if (drop) { drop.remove(); drop = null; } };
    input.addEventListener('input', () => {
      close();
      const q = input.value.trim();
      if (q.length < 2) return;
      later(250, () => {
        close();
        const hits = CODES[kind].filter(([c, d]) => c.startsWith(q) || d.toLowerCase().includes(q.toLowerCase()));
        if (!hits.length) return;
        drop = document.createElement('div');
        drop.className = 'angucomplete-dropdown';
        for (const [c, d] of hits) {
          const row = document.createElement('div');
          row.className = 'angucomplete-row';
          row.textContent = `${c} - ${d}`;
          row.addEventListener('click', () => {
            const tr = table.tBodies[0].insertRow();
            tr.insertCell().textContent = c;
            tr.insertCell().textContent = d;
            input.value = '';
            close();
          });
          drop.append(row);
        }
        wrap.append(drop);
      });
    });
  }

  // Verification: the three Submit buttons are the signatory's. A trusted click goes to the acknowledgement.
  for (const btn of $$('[data-final-submit]')) {
    btn.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      if (!$('#authveri').checked) { $('#verr').textContent = 'Please tick the declaration.'; return; }
      location.href = '/registration/auth/newappl/acknowledgement';
    });
  }
})();
