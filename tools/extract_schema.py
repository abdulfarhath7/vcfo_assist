#!/usr/bin/env python3
"""Extract MCA AEM Adaptive Form field schemas from captured page.html files.

Usage: extract_schema.py <capture-root> <out-dir>
Picks the largest captured page per form URL and emits one JSON schema per form.
"""
import glob, json, os, re, sys
from bs4 import BeautifulSoup

GENERIC = {'guideFieldNode', 'defaultFieldLayout', 'af-field-empty', 'af-field-filled', 'guideTextBox', 'guideNumericBox',
           'guideDropDownList', 'guideRadioButton', 'guideCheckBox', 'guideDatePicker', 'guideFileUpload', 'guideButton',
           'guideTextDraw', 'guideScribble', 'guideTelephone', 'guideEmail', 'guideSwitch', 'guideTable', 'guideImage',
           'guidePasswordBox', 'guideTextArea', 'guideAutoComplete', 'guideCaptcha', 'mca-form-common-header'}
FORM_KEYS = {
    'spice.html': 'spice-part-a', 'SpicePartB.html': 'spice-part-b', 'AgilePro.html': 'agile-pro-s',
    'INC-33.html': 'inc-33-emoa', 'INC-34.html': 'inc-34-eaoa', 'INC-9.html': 'inc-9', 'fologin.html': 'login',
}

MARKERS = {'spice.html': 'SPICe+', 'SpicePartB.html': 'Part B', 'AgilePro.html': 'AGILE', 'INC-33.html': 'INC-33',
           'INC-34.html': 'INC-34', 'INC-9.html': 'INC-9', 'fologin.html': 'Login'}

def slug(s):
    s = re.sub(r'\(.*?\)', ' ', s or '')
    s = re.sub(r'[^a-zA-Z0-9]+', '_', s).strip('_').lower()
    return s[:60]

def pick_pages(root):
    best = {}
    for d in glob.glob(os.path.join(root, 'steps', '*', '0*/')):
        mp = os.path.join(d, 'meta.json')
        if not os.path.exists(mp):
            continue
        u = json.load(open(mp))['url'].split('?')[0]
        base = u.rsplit('/', 1)[-1]
        if base not in FORM_KEYS:
            continue
        sz = os.path.getsize(os.path.join(d, 'page.html'))
        marker = MARKERS[base]
        if marker not in open(os.path.join(d, 'page.html'), encoding='utf-8', errors='replace').read():
            continue  # capture dir mislabelled (page still showed previous form)
        if base not in best or sz > best[base][0]:
            best[base] = (sz, d, u)
    return best

def panel_chain(node):
    chain = []
    for anc in node.parents:
        cls = anc.get('class') or []
        if 'guidePanel' in cls or 'guideRepeatablePanel' in cls:
            hdr = anc.select_one(':scope > .guidePanelDescription, :scope > .guideHeader, :scope > div > .guideHeader, :scope > .panel-heading')
            title = anc.get('title') or (hdr.get_text(' ', strip=True) if hdr else '')
            chain.append({'id': anc.get('id'), 'title': title[:120], 'repeatable': 'guideRepeatablePanel' in cls or anc.get('data-guide-repeatable') == 'true'})
    return list(reversed(chain))

def extract(html, url, key):
    s = BeautifulSoup(html, 'lxml')
    fields = []
    seen = set()
    for n in s.select('.guideFieldNode'):
        nid = n.get('id') or ''
        if not nid or nid in seen:
            continue
        seen.add(nid)
        cls = n.get('class') or []
        ftype = next((c for c in cls if c.startswith('guide') and c not in ('guideFieldNode',)), 'unknown')
        semantic = [c for c in cls if c not in GENERIC and not c.startswith('af-') and not c.startswith('guide')]
        lab = n.select_one('.guideFieldLabel label, .guideFieldLabel')
        label = lab.get_text(' ', strip=True) if lab else (n.get('title') or '')
        w = n.select_one('input, select, textarea, button')
        widget = {}
        if w is not None:
            widget = {'tag': w.name, 'id': w.get('id'), 'name': w.get('name'), 'type': w.get('type'),
                      'placeholder': w.get('placeholder') or None, 'maxlength': w.get('maxlength'),
                      'readonly': w.has_attr('readonly') or None}  # values deliberately not exported: captures hold a real filing
            if w.name == 'select':
                widget['options'] = [{'v': o.get('value', ''), 't': o.get_text(strip=True)} for o in w.select('option')][:300]
        if ftype in ('guideRadioButton', 'guideCheckBox'):
            widget['options'] = [{'v': i.get('value', ''), 't': (i.find_parent('label') or i).get_text(' ', strip=True)[:80], 'id': i.get('id')}
                                 for i in n.select('input[type=radio], input[type=checkbox]')]
            widget['name'] = (n.select_one('input') or {}).get('name') if n.select_one('input') else None
            widget['tag'] = 'input'
        widget = {k: v for k, v in widget.items() if v not in (None, '', [])}
        f = {'id': nid, 'key': (semantic[0] if semantic else slug(label)) or nid, 'label': label[:200], 'type': ftype,
             'semantic': semantic or None, 'mandatory': n.get('data-mandatory') == 'true', 'disabled': n.get('data-disabled') == 'true',
             'widget': widget, 'panels': [p['title'] for p in panel_chain(n) if p['title']][-3:],
             'panelIds': [p['id'] for p in panel_chain(n)][-2:]}
        if not f['semantic']:
            del f['semantic']
        fields.append(f)
    # de-dupe key collisions within form
    counts = {}
    for f in fields:
        counts[f['key']] = counts.get(f['key'], 0) + 1
    seen_k = {}
    for f in fields:
        if counts[f['key']] > 1:
            seen_k[f['key']] = seen_k.get(f['key'], 0) + 1
            f['key'] = f"{f['key']}__{seen_k[f['key']]}"
    buttons = [{'id': b.get('id'), 'text': b.get_text(' ', strip=True)[:60]} for b in s.select('button[id]') if b.get_text(strip=True) and b.get('id') != 'welcomeUser']
    return {'form': key, 'url': url, 'fieldCount': len(fields), 'fields': fields, 'buttons': buttons[:200]}

def compact(sch):
    """Small schema for the extension: shared option sets, no hidden bookkeeping fields."""
    HIDDEN = re.compile(r'^(formId|formName|formVersion|userId|integrationId|referenceNumber|srn|Path_for_PDFGeneration|formIntegrationId|formAttachmentHidden|prefill.*|flag.|saveFlag.*|changeFlag|Validate|panValidate.*|tableItem.*|textbox\d+.*|checkbox\d+.*|.*PinRes.*|.*Prefill)$')
    option_sets, fields = {}, []
    for f in sch['fields']:
        if f['type'] in ('guideButton', 'guideTextDraw', 'guideImage') or HIDDEN.match(f['key']):
            continue
        w = f['widget']
        c = {'id': f['id'], 'key': f['key'], 'label': f['label'], 'type': f['type'][5:].lower(), 'sem': (f.get('semantic') or [None])[0],
             'req': f['mandatory'] or None, 'ro': (f['disabled'] or w.get('readonly')) or None,
             'wid': w.get('id'), 'name': w.get('name'), 'itype': w.get('type'), 'max': w.get('maxlength'), 'panels': f['panels']}
        if w.get('options'):
            opts = [(o.get('v', ''), o['t']) for o in w['options']]
            h = str(abs(hash(json.dumps(opts))))[:10]
            option_sets.setdefault(h, opts)
            c['opts'] = h
        fields.append({k: v for k, v in c.items() if v not in (None, '', [], False)})
    return {'form': sch['form'], 'url': sch['url'], 'fields': fields, 'optionSets': option_sets}

def main():
    root, out = sys.argv[1], sys.argv[2]
    full = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'schemas-full')
    os.makedirs(out, exist_ok=True); os.makedirs(full, exist_ok=True)
    index = []
    for base, (sz, d, u) in sorted(pick_pages(root).items()):
        key = FORM_KEYS[base]
        html = open(os.path.join(d, 'page.html'), encoding='utf-8', errors='replace').read()
        sch = extract(html, u, key)
        sch['source'] = d
        with open(os.path.join(full, key + '.json'), 'w') as fh:
            json.dump(sch, fh, indent=1, ensure_ascii=False)
        with open(os.path.join(out, key + '.compact.json'), 'w') as fh:
            json.dump(compact(sch), fh, separators=(',', ':'), ensure_ascii=False)
        index.append({'form': key, 'url': u, 'fields': sch['fieldCount'], 'file': key + '.json'})
        print(f"{key:14} {sch['fieldCount']:5} fields  <- {d}")
    with open(os.path.join(full, 'index.json'), 'w') as fh:
        json.dump(index, fh, indent=1)

if __name__ == '__main__':
    main()
