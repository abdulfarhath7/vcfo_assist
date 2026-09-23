# 08 — Build phases

All of these are buildable now, without the MCA DOM. Build them in one run. After
each phase: `npm run check` passes, append to `TASKS.md`, append judgement calls to
`QUESTIONS.md`. Each phase leaves the folder loadable.

## P0 — Scaffold
- `package.json` with `"check": "tsc --noEmit"`; devDependencies `typescript`,
  `@types/chrome`
- `jsconfig.json`: `checkJs`, `allowJs`, `strict`, `target: ES2022`,
  `lib: ["ES2022","DOM"]`, `types: ["chrome"]`
- `manifest.json`: MV3, name "VCFO Assist", permissions `storage`, `sidePanel`,
  `scripting`, `tabs`; `host_permissions` for `https://www.mca.gov.in/*` and the
  configured Suite origin; module service worker; classic content script on MCA
  only; side panel registered

## P1 — Shared foundations
- `shared/constants.js` — storage keys, message types, timeouts, danger set
- `shared/schema.js` — JSDoc typedefs: Recipe, Step, FieldMap, FieldDef,
  SuitePayload, RunState, Diff, StepResult
- `shared/result.js` — Ok/Err helper; every fallible function returns it

## P2 — Stubs and loaders
- `recipes/spice-part-a.example.json`, `fieldmaps/spice-part-a.example.json`
- Loader that validates both against the schema, checks version compatibility, and
  refuses `.example` ids outside development mode

## P3 — Suite integration
- `suite/client.js` — export fetch, result post, explicit 401 handling
- `suite/bundle.js` — `.vcfoa` decrypt and expiry check
- `suite/validate.js` — schema, form, version, and sourceField coverage checks
- `fixtures/engagement.json` for development without Suite

## P4 — Content-script primitives
- `content/bridge.js` — message handler, installs nothing until asked
- `content/lib/resolve.js` — shadowPath walk, primary then fallbacks, ambiguity
  failure
- `content/lib/observe.js` — `waitFor`, `waitForGone`, `waitForUrl`
- `content/lib/setvalue.js` — native setter, event dispatch, jQuery MAIN-world
  trigger, read-back

## P5 — Engine
- `engine/ops/*` — one file per operation from `docs/04`
- `engine/guard.js` — danger-set refusal, no override path
- `engine/verify.js` — read-back diff
- `engine/runner.js` — state machine, per-step persistence, resume, tab-navigation
  recovery, failure taxonomy

## P6 — Side panel shell
- `sidepanel/panel.html`, `panel.css` with the VCFO token block, bundled fonts
- Progress rail, header, persistent error slot, Stop control
- Panel routing between the five views

## P7 — The five views
- `views/import.js`, `verify.js`, `autofill.js`, `human-gate.js`, `capture.js`
- Live step list, diff table, human-gate checklist, result preview

## P8 — Return leg
- Read SRN per the result recipe section, preview, post to Suite, idempotent
- Completion state and reset

## P9 — Finish
- `README.md` — install unpacked, set Suite origin, run a form, what Assist will
  never do
- Final `npm run check` clean
- Re-read `docs/04`, `05`, `06` and verify every named behaviour exists; gaps go to
  `QUESTIONS.md`
- Summarise the build at the end of `TASKS.md`
