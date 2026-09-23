# VCFO Assist

A Chrome (Manifest V3) extension that pre-fills MCA V3 portal forms from
engagement data held in VCFO Suite. It is a companion to VCFO Suite, shipped and
versioned with it — not a standalone product.

Assist reads the engagement, navigates the portal, fills every field it has data
for, reads each value back, and then stops. Everything that needs a person —
login, captcha, OTP, DSC signing, payment, final submission — stays with the
person. That is the product, not a temporary limit.

## What Assist will never do

- Log in, solve a captcha, or enter an OTP
- Read, store, fill or log an MCA user id, password, PIN or any credential
- Affix a DSC, pay a fee, or press submit
- Send data anywhere except the VCFO Suite origin you configure
- Keep engagement data on disk (it lives in `chrome.storage.session` and is
  gone when the browser closes)

The step engine refuses to click any control that looks like submit, pay,
confirm, sign, DSC, file, delete or remove, and no recipe can override that.
There is no `submit` operation in the engine.

## Install (unpacked)

1. `npm install && npm run check` — type-checks the source; there is no build
   step and no bundler.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked**, and pick this folder.
3. Click the toolbar icon on any tab. The side panel opens beside it.

Chrome 116 or newer is required (side panel API).

## Set the Suite origin

In panel 1 (**Import**), enter the VCFO Suite origin, e.g.
`https://suite.example.com`, and press **Save**. Chrome asks you to allow that
origin; Assist can only talk to an origin you have allowed. You must be signed
in to Suite in the same browser — Assist uses that cookie session.

Leave the origin empty to work from `fixtures/engagement.json`, a development
payload with obviously fake data. The panel says so in the header.

On an unpacked build, **Development mode** can be switched on in panel 1. It
allows the `.example` recipe and field-map stubs to load. Outside development
mode they are refused.

## Run a form

1. **Import** — pick the form (only SPICe+ Part A is enabled), then load an
   engagement: live from Suite, from the fixture, or from a `.vcfoa` bundle
   exported by Suite for a machine that cannot reach it (you will need the
   passphrase Suite showed once). Press **Continue**.
2. **Verify** — the only place engagement values are shown. Check every row.
   Fields with no value show a "no value" chip. Wrong data is fixed in Suite,
   not here. Open the MCA portal in the active tab, log in yourself, then press
   **Fill the form**.
3. **Autofill** — the step list ticks over as the recipe runs. If a selector
   misses or matches more than one element, the run stops and names the field
   and every selector tried. On completion the read-back diff lists every
   mismatch in full. You can only continue past a mismatch by explicitly
   confirming you have checked it on the form.
4. **Sign, pay, file** — the human gate. Review, DSC, pay, submit — all in your
   hands. The only control is **I have submitted**, which records that you did.
5. **Capture and return** — **Read SRN from page** extracts the SRN per the
   result recipe, previews exactly what will be sent, and **Send to VCFO Suite**
   posts it. Sending the same SRN twice updates, never duplicates.

**Stop** is always available. It aborts the run at the next step boundary,
clears the engagement from the session, and returns to Import.

## The automation is data

Site knowledge lives in two JSON files per form, not in code:

- `recipes/<form>.json` — the ordered steps to reach and fill the form
- `fieldmaps/<form>.json` — each field's selectors and its Suite source field
- `recipes/<form>.result.json` — where the SRN appears afterwards

The real MCA DOM has not been captured yet. `*.example.json` stubs with
placeholder selectors ship now so the engine, validation and panel can be
exercised. When the capture arrives, the real files drop in and nothing else
changes. See `docs/04-recipe-and-fieldmap.md` and `docs/10-deferred.md`.

## Layout

```
manifest.json           MV3 manifest: module worker, classic content scripts on mca.gov.in only
src/worker.js           service worker: run orchestration, Suite client, panel requests
src/shared/             constants, JSDoc typedefs, Ok/Err result helper
src/suite/              Suite API client, .vcfoa bundle decrypt, payload validation
src/engine/             loader, guard, transport, runner, verify, ops/ (one file per op)
src/content/            content-script bridge and primitives (window.__VA)
src/sidepanel/          the five-panel wizard: panel.html/css/js, views/
recipes/  fieldmaps/    automation data (stubs for now)
fixtures/engagement.json development payload
docs/                   the specification; 04 and 06 are the contract
```

`docs/09-acceptance.md` is the manual checklist. `TASKS.md` is the build log
and `QUESTIONS.md` holds every judgement call with the default chosen.

## SPICe+ capture and autofill prototype

`capture/`, `extension/`, `schemas-full/` and `tools/` hold the SPICe+ autofill
prototype built from live MCA portal captures. See
[docs/spice-autofill.md](docs/spice-autofill.md).
