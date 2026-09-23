# 06 — Acceptance checklist

For the human, after the build. Load the root folder unpacked at `chrome://extensions`.

## Consolidation
- [ ] Only one manifest is loadable; `legacy/extension/manifest.json.disabled` cannot
      be loaded by accident
- [ ] `legacy/README.md` explains why the folder exists
- [ ] `npm run check` clean

## Generation
- [ ] `node tools/build-fieldmaps.mjs` runs and prints a per-form summary
- [ ] `fieldmaps/spice-part-a.json` has ~105 entries; bound and unbound counts look
      sane
- [ ] `waitForOptions` survives on `area`, `class-of-company`, `category-of-company`
- [ ] The NIC note survives on `nic-text-box`
- [ ] No `.example` file remains in `fieldmaps/` or `recipes/`
- [ ] Deliberately renaming a binding in `mapping.js` makes the generator fail loudly

## Navigation
- [ ] `recipes/spice-part-a.json` navigates by URL, contains no menu clicks and no
      `humanGate` for navigation
- [ ] A recipe with a non-`mca.gov.in` URL is refused by the guard

## The one button — on the live portal
- [ ] With Suite open on an engagement, the panel preselects it and shows the company
      name
- [ ] Start SPICe+ Part A loads the profile without any typing
- [ ] MCA opens; the panel waits at the login gate
- [ ] After login and Continue, the extension lands on the Part A form unaided
- [ ] Fields fill; the verify diff lists what did not stick
- [ ] Nothing is submitted, paid for, or signed

## Data handling
- [ ] `mcaLogin.userId` empty everywhere
- [ ] No MCA credential in storage, logs or requests
- [ ] The profile reaches no origin other than the MCA tab being filled
- [ ] Signed out of Suite, the 401 message offers to focus the Suite tab
