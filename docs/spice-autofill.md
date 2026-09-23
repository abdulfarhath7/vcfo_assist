# vCFO Assist — MCA SPICe+ autofill extension

Chrome extension (Manifest V3) that fills the MCA V3 SPICe+ incorporation forms from a vCFO client profile.
Built from DOM/network captures of the live portal (`~/mca-capture`, 2026-09-23).

```
extension/            load this folder in chrome://extensions (Developer mode → Load unpacked)
  manifest.json
  content/filler.js   fill engine: locates AEM Adaptive Form fields, sets values, scans, discovers
  lib/mapping.js      vCFO profile → per-form field keys
  popup/              UI: profile JSON, Preview, Fill, Scan, Discover
  schemas/*.compact.json   captured field schemas (key, label, type, options, required, read-only)
  sample/profile.sample.json
tools/extract_schema.py    regenerates schemas from ~/mca-capture captures
tools/test_filler.js       offline test of the fill engine against captured DOM (playwright)
```

## How it works

MCA forms are Adobe AEM Adaptive Forms. Every field is a `.guideFieldNode` carrying a
semantic CSS class (`type-of-company`, `proposedname1`, `din7a`, `correspondenceaddress_pinCode` …).
Those classes are the field keys. They are stable across repeat-panel instances (subscriber #1, #2 …),
unlike the numeric widget ids, so the engine resolves `key` + `instance` → nth `.guideFieldNode.<key>` on the page.

Values are set through the native value setter and `input/change/blur` events so AEM's jQuery handlers fire
(pin-code lookups, dependent dropdowns, totals). Dependent selects are polled up to 8 s for the option to appear.

## Usage

1. Load `extension/` unpacked. Log in to MCA yourself (captcha + OTP are never automated).
2. Open a form page: SPICe+ Part A (`spice.html`), Part B (`SpicePartB.html`), AGILE-PRO-S, INC-33, INC-34, INC-9.
3. Click the extension icon → paste / import the client profile JSON (start from **load sample**) → **Save profile**.
4. **Preview mapping** shows what will be written. **Fill this page** writes it and logs per-field status:
   `filled`, `readonly`, `nomatch` (dropdown text differs), `notfound` / `hidden` (field not in this section),
   `noinstance` (open the Add/Edit sub-panel for subscriber #n first), `manual` (file uploads).
5. Part B is a 10-section wizard. Fill, click **Next**, fill again — the engine only touches visible fields.
   For subscriber/director sub-panels: open Add/Edit, click Fill, save the sub-panel, repeat.
6. **Scan values** exports what the page currently holds (useful to build a profile from an existing filing).
7. **Discover fields** exports the schema of whatever is on screen. Use it on Part B sections 6–10
   (OPC nomination, Stamp duty, PAN/TAN, Attachments, Declaration) which were not in the captures, then
   add keys to `lib/mapping.js`.

## Profile model

See `extension/sample/profile.sample.json`. Top-level: `company`, `registeredOffice`, `subscribers[]`,
`directors[]` (directors who are not subscribers), `agile`, `moa`, `aoa`, `mcaLogin.userId`.
Subscriber `kind`: `individual` (with `din` → 6b block, without → 6c block) or `bodyCorporate` (6a).
Dropdown values must match the portal's option text (case-insensitive, prefix/contains match is tried).
Dates `DD/MM/YYYY`.

## Not automated (portal restrictions)

Captcha, mobile/email OTP, DSC signing, file attachments, payment, NIC-code picker popup (search text is filled, row must be clicked).

## Verify before production

- Section 3 count fields of Part B (`totalNumberOfFirstSubsMOAHavingVal`, `DirectorDINCount`, …) are mapped by
  key name; confirm against the labels on a live form.
- Login page loads `clientlib-devtool.js` (disable-devtool). It redirects automated/CDP browsers; a normal
  Chrome with the extension is unaffected, but do not keep DevTools open on MCA pages.

## Regenerate schemas

```
python3 tools/extract_schema.py ~/mca-capture extension/schemas
node tools/test_filler.js
```
