# TASKS

Append-only build log. One entry per phase. Newest at the bottom.

## <date> — P<n> <phase name>
- Built:
- Files:
- Left out:
- `npm run check`: pass / fail

---

## 2026-09-16 — P0 Scaffold
- Built: `package.json` (`check` = `tsc -p jsconfig.json --noEmit`), `jsconfig.json`
  (checkJs, allowJs, strict, ES2022, DOM, chrome types), MV3 `manifest.json`
  (module service worker, classic content scripts on `https://www.mca.gov.in/*`
  only, side panel, permissions `storage sidePanel scripting tabs`, strict
  extension-page CSP with no remote script/style/font), placeholder
  `src/worker.js` and `src/sidepanel/panel.html`, generated PNG icons.
- Files: `package.json`, `jsconfig.json`, `manifest.json`, `src/worker.js`,
  `src/sidepanel/panel.html`, `assets/icons/icon-{16,48,128}.png`
- Left out: the Suite origin is not a fixed host permission — see Q1. Dev origin
  `http://localhost:3000` is pre-declared so a local Suite needs no prompt.
- `npm run check`: pass

## 2026-09-16 — P1 Shared foundations
- Built: `shared/constants.js` (storage keys split session/local, panel↔worker
  message types, content op type, timeouts incl. wait slicing, danger set and
  credential set as pattern sources so the content script can re-check them,
  allowed ops/transforms/modes, Suite API paths, forms registry);
  `shared/schema.js` (typedefs for Recipe, Step, Precondition, FieldMap,
  FieldDef, Selectors, ResultRecipe, SuitePayload, SuiteResult, BundleEnvelope,
  RunState, StepResult, Diff, LogEntry, PauseReason, VerifyRow, Prepared,
  PanelSnapshot, PanelRequest, ContentRequest/Response, ElementDescriptor,
  and the `window.__VA` API shapes); `shared/result.js` (Ok/Err/fromThrown/isOk).
- Files: `src/shared/constants.js`, `src/shared/schema.js`, `src/shared/result.js`
- Left out: nothing.
- `npm run check`: pass

## 2026-09-16 — P2 Stubs and loaders
- Built: `recipes/spice-part-a.result.example.json` (return-leg stub with an
  `srn` and optional `status` extract); `shared/check.js` (structural checks
  that name the failing path); `engine/loader.js` — fetches packaged JSON,
  falls back to `.example.json` only in development mode, refuses any id
  ending in `.example` outside it, validates recipe / field map / result
  recipe shapes (ops from the fixed set so no `submit` can exist, halt last,
  transforms from the fixed list, entry modes, stability, dependsOn references
  and cycles, credential-like fields refused), `checkCompatibility`
  (map id, map version ≥ recipe requirement, schema versions, origins, step
  references), `orderedFields` (dependsOn-respecting fill order), `findField`.
- Files: `recipes/spice-part-a.result.example.json`, `src/shared/check.js`,
  `src/engine/loader.js`
- Left out: the existing recipe/fieldmap stubs were kept as shipped.
- `npm run check`: pass

## 2026-09-16 — P3 Suite integration
- Built: `suite/client.js` (origin preference + normalisation, host-permission
  helpers for the panel to call under a user gesture, list / export / result
  calls with `credentials: "include"`, worker-owned 20s timeout, explicit 401
  message "Sign in to VCFO Suite in another tab, then retry", 404 on the list
  endpoint degrades to a typed engagement id, fixture read when no origin is
  set, idempotency key `{engagementId}:{form}:{srn}` on the result post);
  `suite/bundle.js` (envelope parse, expiry refusal before decryption,
  PBKDF2-SHA-256 → AES-GCM decrypt via WebCrypto, wrong passphrase is a named
  error); `suite/validate.js` (payload shape, schemaVersion, Suite version
  skew both directions, form match, map/recipe schema requirement, missing
  non-optional sourceFields listed by key, payload expiry);
  `fixtures/engagement.json` with obviously fake data.
- Files: `src/suite/client.js`, `src/suite/bundle.js`, `src/suite/validate.js`,
  `fixtures/engagement.json`
- Left out: nothing.
- `npm run check`: pass

## 2026-09-16 — P4 Content-script primitives
- Built: four classic scripts sharing `window.__VA`, each IIFE-wrapped.
  `content/lib/resolve.js` — shadowPath walk, primary then fallbacks, exactly
  one visible match or a failure listing every selector with its match count
  (`ambiguity` when any candidate matched >1, `resolution` otherwise), element
  descriptor that carries `value` only for button-like controls.
  `content/lib/observe.js` — `waitFor` / `waitForGone` / `waitForUrl` on a
  MutationObserver plus 150ms poll, `settle` quiet-period wait, `sleep`.
  `content/lib/setvalue.js` — native prototype setter, `input` → `change` →
  `blur`/`focusout` bubbling, select option match by value or text, marker
  attribute for the worker's MAIN-world jQuery trigger, read-back returning
  displayed text plus underlying value, checkbox/radio via real click,
  widget picking (open, wait for ARIA options or map-declared
  listbox/option selectors, exact match by text or data-value, click, read
  displayed value), `readText` for the return leg.
  `content/bridge.js` — `va.op` listener that only accepts the extension's
  own sender, ops: ping, describePage, exists, inspect, click, setValue,
  readBack, pickWidget, check, waitFor, waitForGone, waitForUrl, settle,
  readText. Re-checks the danger set before every click and the credential
  set before every fill using the pattern set passed in the op.
- Files: `src/content/lib/resolve.js`, `src/content/lib/observe.js`,
  `src/content/lib/setvalue.js`, `src/content/bridge.js`
- Left out: the jQuery MAIN-world trigger lives in the worker (P5) because
  the isolated world cannot see page globals.
- `npm run check`: pass

## 2026-09-16 — P5 Engine
- Built: `engine/guard.js` (danger-set click refusal with no override path,
  credential-field refusal, pattern sets handed to the content script for its
  own re-check); `engine/transform.js` (the fixed transform set, date
  parsing for both directions); `engine/transport.js` (worker-owned
  timeouts, receiver-gone detection, wait for `tabs.onUpdated` complete,
  programmatic content-script injection, one retry then transport failure,
  MAIN-world jQuery trigger via `chrome.scripting.executeScript`);
  `engine/context.js` (OpContext, pure `lookupValue` shared with panel 2);
  `engine/verify.js` (read-back diff, choice vs text comparison rules,
  cumulative merge); `engine/fieldfill.js` (per-field flow: credential
  guard, dependency settle via `loadingSelector` or quiet period, typed /
  widget / check paths, exactly one re-attempt on mismatch); `engine/waits.js`
  (sliced waits so the worker idle timer keeps resetting and Stop is honoured
  between slices); `engine/ops/*` one file per op — click, fill, fillGroup,
  select, check, waitFor, waitForGone, waitForUrl, assert, humanGate, halt —
  and a frozen registry with no submit entry; `engine/runner.js` (RunState
  persisted before and after every step, resume on wake, non-idempotent
  in-flight step pauses for a human retry/skip decision, humanGate pause,
  halt, abort at the next step boundary, failure taxonomy into
  `state.error`, run log without values, mismatch override, "I have
  submitted" record).
- Files: `src/engine/{guard,transform,transport,context,verify,fieldfill,waits,runner}.js`,
  `src/engine/ops/{index,click,fill,fillGroup,select,check,waitFor,waitForGone,waitForUrl,assert,humanGate,halt}.js`
- Left out: nothing from docs/04–06. See Q9–Q11 for judgement calls.
- `npm run check`: pass

## 2026-09-16 — P6 Side panel shell
- Built: `sidepanel/panel.html` (header with wordmark, "Assist", version and
  connected origin; rail; view; persistent error slot; Stop and primary
  button); `sidepanel/panel.css` (the VCFO token block inlined, dark mode in
  the same cool family, bundled Manrope / Space Grotesk / IBM Plex Mono
  woff2 with `@font-face`, JourneyNode-style rail states, chips, cards,
  banners, tables, step list, diff rows, checklist, restrained motion with a
  reduced-motion guard); `sidepanel/dom.js` (element builder — no innerHTML,
  so values never pass through markup); `sidepanel/context.js` (ViewContext,
  View, Stage types); `sidepanel/panel.js` (snapshot fetch, stage derivation
  and clamping so the panel can never show a stage the state does not
  allow, rail rendering, error slot with class label and missing-key list,
  primary-button wiring from the active view, Stop that aborts at the next
  step boundary, waits for the runner to reach a terminal status, resets and
  returns to Import, live updates from `chrome.storage.onChanged`).
  Fonts bundled in `assets/fonts/` with an OFL notice.
- Files: `src/sidepanel/{panel.html,panel.css,panel.js,dom.js,context.js}`,
  `src/sidepanel/views/*.js` (placeholders), `assets/fonts/*`
- Left out: the five views (P7).
- `npm run check`: pass

## 2026-09-16 — P7 The five views
- Built: `views/import.js` (Suite origin editor that requests the host
  permission under the user's click before saving, development-mode toggle
  for unpacked builds, form picker with only SPICe+ Part A enabled,
  engagement picker: list from Suite or the fixture, typed id when Suite has
  no list endpoint, `.vcfoa` file + passphrase held in memory and discarded
  after one attempt, engagement name as the display heading with a source
  chip); `views/verify.js` (per-section table of label / value / source
  field, "no value" waiting chips, over-length warnings, fragile-selector
  banner, example-stub banner, never collapsible, no edit); `views/autofill.js`
  (status banner per run status with the failure class, message, selectors
  and match counts; live step list with done / active / failed / skipped /
  locked states; human-gate continue; interrupted-step retry / skip; read-back
  diff with matches collapsed to a count and mismatches listed in full;
  explicit mismatch override; run log without values); `views/human-gate.js`
  (waiting banner, five-item checklist, "I have submitted" as the only
  control); `views/capture.js` (Read SRN from page, exact preview of the
  result to be sent, Send to VCFO Suite, teal completion state, Start another
  form, fixture-mode "finish without sending").
- Files: `src/sidepanel/views/{import,verify,autofill,human-gate,capture}.js`
- Left out: nothing.
- `npm run check`: pass

## 2026-09-16 — P8 Return leg
- Built: worker `captureResult` — loads `recipes/<form>.result.json` (stub in
  dev mode), checks origin and preconditions, ensures the content script,
  reads each `extract` field with `readText`, applies the optional pattern
  (first capture group), requires `srn`, builds the `SuiteResult` with
  `fieldsWritten`, mismatches and the recipe / map versions that ran, and
  stores it in session; worker `postCaptured` — POSTs to
  `/api/assist/engagements/{id}/result` with `credentials: "include"` and an
  `Idempotency-Key` of `{engagementId}:{form}:{srn}`, explicit 401 message,
  marks the capture posted and clears the engagement payload and verify rows
  from session storage per docs/07; panel 5 previews exactly the posted body
  and offers the reset. Runner guards against reset / reload while a run is
  live, and an orphaned loop stops without re-persisting.
- Files: `src/worker.js`, `src/engine/runner.js`, `src/sidepanel/views/capture.js`
- Left out: Suite's side of idempotency (`{engagementId, form, srn}`) is the
  server's contract; the header is advisory.
- `npm run check`: pass

## 2026-09-16 — P9 Finish
- Built: `README.md` (install unpacked, set the Suite origin, run a form,
  what Assist will never do, layout). Re-read `docs/04`, `05`, `06` and
  checked every named behaviour against the code; the only deviations are
  recorded as Q15–Q19. Ran a throwaway scratchpad script (not committed)
  against the pure functions: the stubs and fixture pass the loader and
  validator; a `submit` op, a credential-like field, missing sourceFields, a
  wrong schemaVersion and a newer Suite version are each refused with a named
  message; the guard refuses `type="submit"` and "Proceed to Pay" and allows
  "Company e-Filing" and "Incorporation & Changes"; transforms behave.
- Files: `README.md`, `TASKS.md`, `QUESTIONS.md`
- Left out: nothing.
- `npm run check`: pass

---

## Build summary — 2026-09-16

**What exists.** A loadable MV3 extension: module service worker
(`src/worker.js`), side panel with the five-panel wizard
(`src/sidepanel/`), and four classic content scripts on `mca.gov.in` sharing
`window.__VA` (`src/content/`). ~6,800 lines of plain JavaScript with JSDoc,
`tsc --noEmit --strict` clean, no bundler, no tests, no runtime dependencies.

**Contract kept.**
- The automation is data: `engine/loader.js` reads `recipes/*.json` and
  `fieldmaps/*.json`, validates their shape, checks versions, refuses
  `.example` outside development mode. No MCA selector exists in engine or UI
  code; every selector reaches the content script inside an op message.
- Human boundary: `engine/guard.js` refuses danger-set clicks with no
  override, the content bridge re-checks with the same patterns before
  clicking, the op registry has no `submit`, credential-like fields are
  refused by the loader, the worker and the content script. Panel 4's only
  control is "I have submitted".
- No credential storage; engagement data, verify rows, run state and diffs
  in `chrome.storage.session` only; preferences in `local`.
- Fail loud: zero or multiple matches, timeouts, guard refusals and transport
  failures stop the run and name the field, every selector tried and its
  match count. Read-back mismatches are collected, listed in full, and block
  panel 3's continue unless the lead explicitly overrides.
- Egress only to the configured Suite origin (host permission requested at
  save time); strict extension-page CSP; fonts bundled.
- UI on the VCFO token block, JourneyNode-style rail, dark mode, restrained
  motion.

**Waiting on the DOM capture.** `recipes/spice-part-a.json`,
`fieldmaps/spice-part-a.json`, `recipes/spice-part-a.result.json`. Until then
the `.example` stubs load in development mode only.

**For the human.** `docs/09-acceptance.md` is the manual checklist;
`QUESTIONS.md` holds Q1–Q19 with the default taken for each.

## 2026-09-16 — Review round 1 (owner answers to Q1–Q19)
- Built: **Q7** — `COMPATIBLE_SUITE` replaced by `KNOWN_SUITE_RANGE`; the
  Suite version check is now `suiteVersionWarning()` and never refuses;
  `validatePayloadForForm` returns `{ warnings }`; `Prepared.warnings`
  shown as a banner on Verify. Only `schemaVersion` blocks.
  **Q9** — `collectInFlightEvidence()` inspects the page after a restart
  (URL, target found, field already holds its value, n of m for a group;
  booleans and counts only); `PauseReason.evidence`; action renamed
  `continue | retry`; panel 3 shows the evidence card, "It happened —
  continue" is the primary, retry is the ghost secondary.
  **Q12** — `valuesMatch()` runs the page value through the field's own
  transform and trims both sides before comparing text; choice fields stay
  case-insensitive.
  **Q11 note** — readiness handshake: `ping` carries the runId and the bridge
  echoes it; `ensureBridge()` waits for the tab to finish loading, handshakes,
  and injects only if that still fails. Used by run start, transport
  recovery and result capture.
  **Q18 note** — `LOG_CAP` = 200 in constants.
  **Q13** — `--font-serif` alias added; H1 uses it.
- Files: `src/shared/{constants,schema}.js`, `src/suite/validate.js`,
  `src/engine/{verify,transport,runner}.js`, `src/content/bridge.js`,
  `src/worker.js`, `src/sidepanel/panel.css`,
  `src/sidepanel/views/{autofill,verify}.js`, `QUESTIONS.md`
- Left out: nothing. Scratchpad sanity re-run: newer Suite version passes
  with a warning, schema mismatch still blocks, trimmed/upper-cased page
  value reads as a match, choice compare unchanged.
- `npm run check`: pass
