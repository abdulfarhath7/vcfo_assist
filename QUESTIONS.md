# QUESTIONS

Append-only. Every judgement call the spec doesn't cover. Don't block — pick the
default, record it, keep building. The human answers after the build.

## Q<n> — <short title>
- **Context:**
- **Default chosen:**
- **Alternative:**
- **Answer:** _(left blank for the human)_

---

## Q1 — Suite origin before first configuration
- **Context:** `docs/03` says ship with a development origin and let the user
  change it. The extension cannot request a `host_permission` for an origin it
  does not know at install time.
- **Default chosen:** declare `optional_host_permissions` and request the origin
  at the moment the user saves it in the panel.
- **Alternative:** ship a fixed production origin in the manifest.
- **Answer:** Confirmed as built (2026-09-16).

## Q2 — Which field map version a recipe requires
- **Context:** `docs/04` says refuse when `fieldmap.version` is behind "the
  recipe's `requiresFieldMap` version", but `requiresFieldMap` in the stub is
  an id string, not a version.
- **Default chosen:** `requiresFieldMap` stays the id. An optional integer
  `requiresFieldMapVersion` (default 1) carries the minimum version.
- **Alternative:** make `requiresFieldMap` an object `{ id, version }`.
- **Answer:** Confirmed as built (2026-09-16).

## Q3 — Result recipe shape
- **Context:** `docs/10` names `recipes/spice-part-a.result.json` for the SRN
  but no shape is specified.
- **Default chosen:** `{ id, version, form, label, origin, preconditions,
  extract: [{ key, label, selectors, read: text|value|attribute, attribute?,
  pattern?, optional }] }`. `srn` is mandatory; `pattern`'s first capture group
  (or whole match) is kept. Stub at `recipes/spice-part-a.result.example.json`.
- **Alternative:** fold the extract section into the fill recipe.
- **Answer:** Confirmed as built (2026-09-16).

## Q4 — What "development mode" is
- **Context:** the `.example` stubs are loadable only in development mode, but
  nothing defines how the panel knows it is in one.
- **Default chosen:** a preference toggle in panel 1, stored in
  `chrome.storage.local`, default off, and only offered when the extension is
  unpacked (manifest has no `update_url`).
- **Alternative:** treat "unpacked" alone as development mode, no toggle.
- **Answer:** Confirmed as built (2026-09-16).

## Q5 — Engagement list endpoint
- **Context:** panel 1 shows an engagement picker "if Suite returned more than
  one", but `docs/03` only defines a per-engagement export URL.
- **Default chosen:** call `GET {origin}/api/assist/engagements?form=<id>`
  expecting `{ engagements: [{ id, companyName, stage }] }`. A 404 means the
  endpoint does not exist yet; the panel then offers a typed engagement id.
- **Alternative:** always require a typed or pasted engagement id.
- **Answer:** Confirmed as built (2026-09-16).

## Q6 — .vcfoa envelope format
- **Context:** `docs/03` says AES-GCM with a passphrase but no envelope shape.
- **Default chosen:** JSON `{ format: "vcfoa", version: 1, manifest: { issuedAt,
  expiresAt, form, engagementId }, kdf: { name: "PBKDF2", salt, iterations,
  hash: "SHA-256" }, cipher: { name: "AES-GCM", iv }, ciphertext }` with base64
  binary fields. Suite's exporter must produce this shape.
- **Alternative:** a binary container with a magic header.
- **Answer:** Confirmed as built (2026-09-16).

## Q7 — Suite version compatibility range
- **Context:** `docs/03` names a pinned `compatibleSuite` range but no values.
- **Default chosen:** `COMPATIBLE_SUITE = { min: "2026.09.0", max: "2026.12.99" }`
  in `shared/constants.js`, compared as dotted integers. Both older and newer
  are refused with distinct messages.
- **Alternative:** refuse only newer, accept any older.
- **Answer:** Changed (2026-09-16). A hardcoded upper bound guarantees a break in January. Block only on `schemaVersion` mismatch. A `suiteVersion` outside the known range is a warning in the panel; filling continues. Version skew is a smell, not a fault. Built: `KNOWN_SUITE_RANGE` in constants, `suiteVersionWarning()` in `suite/validate.js`, warnings carried on `Prepared.warnings` and shown as a banner on Verify.

## Q8 — Widget option discovery
- **Context:** `docs/05` says widget fields "click the control, wait for the
  listbox, click the option", but the listbox markup is unknown until the
  capture.
- **Default chosen:** default to ARIA (`[role=listbox]`, `[role=option]` and
  siblings) and let the field map override with `entry.listboxSelector` and
  `entry.optionSelector`. Option match is exact on text or `data-value`,
  case-insensitive, never prefix.
- **Alternative:** require the map to declare both selectors for every widget.
- **Answer:** Confirmed as built (2026-09-16).

## Q9 — Step in flight when the worker restarts
- **Context:** `docs/05` says resume at `stepIndex` and never replay a
  completed step. A step that was mid-execution when the worker died is
  neither completed nor not started; for `click`/`fill` a blind re-send could
  be a second navigation or a double entry.
- **Default chosen:** persist `inFlight` before dispatch. On wake, an
  in-flight wait/assert is re-run; an in-flight click/fill/fillGroup/select/
  check pauses the run and panel 3 asks the lead to retry or skip it after
  looking at the page.
- **Alternative:** always re-run the in-flight step.
- **Answer:** Changed (2026-09-16). Do not default to retry: a click may already have navigated, so a retry fires a second navigation. Show the evidence (current URL, whether the target still exists, whether the field already holds its value, for a group how many fields do), default to continue, offer retry as the secondary. Built: `collectInFlightEvidence()` in the runner, `PauseReason.evidence`, action renamed `continue | retry`, panel 3 shows the evidence card with "It happened — continue" as primary.

## Q10 — Surviving long waits without the `alarms` permission
- **Context:** the permission list in `docs/08` has no `alarms`; a 30s
  `waitFor` can outlive the worker's idle timer.
- **Default chosen:** the worker sends long waits to the content script in
  8s slices and loops; each reply resets the idle timer, and Stop is honoured
  between slices. The resume path covers the case where it still dies.
- **Alternative:** add `alarms` and a keep-alive alarm.
- **Answer:** Confirmed as built (2026-09-16).

## Q11 — Content script missing on a tab opened before install
- **Context:** manifest content scripts only inject on page load; a tab that
  was already open has no bridge.
- **Default chosen:** on a failed `ping`, inject the four content files with
  `chrome.scripting.executeScript` (isolated world, same order as the
  manifest) and ping again. The bridge guards against double install.
- **Alternative:** tell the lead to reload the tab.
- **Answer:** Confirmed as built (2026-09-16), with a readiness handshake: the ping carries the runId and only a reply echoing it counts as a live bridge; the worker waits for the tab to finish loading before deciding, so a slow existing content script is not double-injected. Built: `handshake()` and `ensureBridge()` in `engine/transport.js`.

## Q12 — Value comparison on read-back
- **Context:** `docs/05` does not say how strict the comparison is.
- **Default chosen:** text controls compare exactly after trimming (the
  transforms the lead approved in panel 2 are part of the value); select and
  widget controls match the displayed text or the underlying option value,
  case-insensitively; checkboxes compare `true`/`false`.
- **Alternative:** case-insensitive everywhere.
- **Answer:** Changed (2026-09-16). Exact compare produces false mismatches the moment the portal trims or upper-cases. Compare after applying the field's own transform to the page value; leading and trailing whitespace are equal. Choice fields stay case-insensitive. Built in `verify.valuesMatch()`.

## Q13 — "Serif display heading" vs the token block
- **Context:** `docs/02` panel 1 asks for the engagement name "as a serif
  display heading, matching Suite's company H1", but the token block defines
  `--font-display` as Space Grotesk, a sans.
- **Default chosen:** use `--font-display` (Space Grotesk). The tokens are
  the contract; the word "serif" is read as a slip.
- **Alternative:** bundle a serif and add a `--font-serif` token.
- **Answer:** Not a slip (2026-09-16). Suite hooks Space Grotesk as `--font-serif`; `--font-display` is the same face, so the outcome is identical and the naming here is cleaner. Added `--font-serif: var(--font-display)` so the company H1 uses Suite's name for it.

## Q14 — Bundled fonts
- **Context:** `docs/02` allows bundled woff2 or a system fallback.
- **Default chosen:** bundle latin woff2 subsets of Manrope (variable),
  Space Grotesk (variable) and IBM Plex Mono 400/500, all SIL OFL, with a
  licence note in `assets/fonts/LICENSES.md`. ~77 KB total, no network.
- **Alternative:** ship without fonts and rely on the system stack.
- **Answer:** Confirmed as built (2026-09-16).

## Q15 — Danger set also refuses `type="image"`
- **Context:** `docs/06` lists `type="submit"` and the text pattern. An
  `<input type="image">` is a submit button in HTML.
- **Default chosen:** treat `type="image"` as submit in the guard. This
  narrows what Assist will click; it never widens it.
- **Alternative:** match the doc literally and rely on the text pattern.
- **Answer:** Confirmed as built (2026-09-16).

## Q16 — Status tints on banners
- **Context:** `docs/02` says status colour appears on chips and icons only,
  never as page fill. Panel 3/4 banners (waiting, danger, success) use a
  10–18% tint of the status colour as their background with a status-colour
  border.
- **Default chosen:** keep the tinted banners; the page background stays
  `--bg`, and the tint is a component surface, not page fill.
- **Alternative:** neutral banners with only a coloured left border and chip.
- **Answer:** Confirmed as built (2026-09-16).

## Q17 — Content message type name
- **Context:** `docs/05` shows the worker sending `{ type: "op", … }`.
- **Default chosen:** the type is `va.op` so a stray message from another
  extension or page script cannot collide with it; the bridge also checks
  `sender.id`.
- **Alternative:** the literal `"op"`.
- **Answer:** Confirmed as built (2026-09-16).

## Q18 — Where the run log lives
- **Context:** `docs/05` says the run log is kept in memory and shown in the
  panel.
- **Default chosen:** it is part of `RunState` and therefore persisted to
  `chrome.storage.session` with it (capped at 400 entries), so it survives a
  worker restart and is still cleared when the browser closes. It never
  contains a value.
- **Alternative:** worker memory only, lost on restart.
- **Answer:** Confirmed as built (2026-09-16), capped at 200 entries: session storage is not unbounded. `LOG_CAP` in constants.

## Q19 — Idempotency signal on the result post
- **Context:** `docs/03` says the post is idempotent on
  `{ engagementId, form, srn }` but does not say how the client signals it.
- **Default chosen:** send an `Idempotency-Key: {engagementId}:{form}:{srn}`
  header in addition to the body; Suite may ignore it and key on the body.
- **Alternative:** PUT to a resource path that includes the SRN.
- **Answer:** Confirmed as built (2026-09-16).

## Q20 — SPICe+ menu items have no verified selector
- **Context:** the Part A recipe navigates MCA Services → Company e-Filing →
  Incorporation & Changes → SPICe+. The capture (`~/mca-capture/steps/2026-09-23T11-35-39-714Z`)
  recorded no click on the first three: they are hover menus. It recorded the final
  click on an `<a>` with no id, class or href, one of several links inside
  `#nav-submenu-10 li.level-3`, so no unique selector exists for it either.
- **Default chosen:** four `humanGate` steps, one per menu level, each telling the
  lead what to click. The run resumes with `waitForUrl` on the captured
  `/e-filing/incorporation-change-services/spice.html`.
- **Alternative:** re-capture with hrefs recorded and click `a[href*="spice.html"]`,
  or navigate straight to the SPICe+ URL.
- **Answer:**

## Q21 — The SPICe+ information pop-up
- **Context:** every capture of `spice.html` and `SpicePartB.html` shows an
  information modal whose OK button is `#okInfoModalBtn`.
- **Default chosen:** `waitFor` (20s) then `click` on the captured `#okInfoModalBtn`.
  If MCA stops showing the pop-up, the run fails loudly at that step.
- **Alternative:** a `humanGate` ("close the pop-up if shown").
- **Answer:**

## Q22 — mapping.js defaults are not carried into the field maps
- **Context:** the reference `mapping.js` fills values the profile does not hold:
  type "New Company (Others)", class "Equity", designation "Director", category
  "Promoter", nationality "India", country code "+91", MoA Table A / AoA Table F,
  AGILE declarations ticked, Part B section 3 counts. A field map entry has no
  default, and the Suite contract says an omitted value is not filled.
- **Default chosen:** not ported. The generator lists computed keys under
  `_skipped`; a field with no Suite value shows "no value" in panel 2 and is skipped
  (optional) or reported (required). Suite's `notes` tell the lead which answers are
  theirs.
- **Alternative:** add an optional `default` to `FieldDef`, generated from mapping.js.
- **Answer:**

## Q23 — Repeated semantic classes (`OccupationType__2`)
- **Context:** the capture names the nth node carrying a class `class__n`. The
  reference `filler.js` resolves such a key by its class and then takes node
  `instance || 0`, so `OccupationType__2` hits the *first* OccupationType node —
  apparently a bug. In repeat rows the right node also shifts with the rows above.
- **Default chosen:** `instance` = captured occurrence (n − 1) plus the row, and the
  entry is marked `fragile` when both apply. 81 of 610 Part B fields are fragile.
- **Alternative:** re-capture with every block populated to learn real positions.
- **Answer:**

## Q24 — guideFieldNode without `instance`
- **Context:** `filler.js` took the first node with the class; this build's rule is
  exactly one visible match or a named failure.
- **Default chosen:** without `instance`, exactly one *visible* node must carry the
  class (more is an `ambiguity` failure). With `instance`, the nth node in document
  order, which must be visible.
- **Alternative:** first node, as filler.js did.
- **Answer:**

## Q25 — dependsOn, repeat rows, conflicts
- **Context:** mapping.js has no explicit dependencies; it fills in order and lets a
  `waitForOptions` field wait for its options.
- **Default chosen:** a `waitForOptions` field depends on the field just before it in
  its section (type → class → category → sub-category; PIN code → area). Probed rows:
  3 subscribers per block, 5 directors per block, 3 AGILE other directors, 3
  other-company interests on the first director with DIN only (mapping.js numbers
  interest rows form-wide, so a second director's rows collide). INC-34 `place__3` is
  written by both subscriber 3 and the witness in mapping.js; the subscriber wins and
  the conflict is listed in `_conflicts`. INC-9's map is empty because mapping.js
  maps nothing for INC-9. Framework is `aem`; the jQuery trigger still runs.
- **Alternative:** hand-declare dependencies per form.
- **Answer:**

## Q26 — Engagement picker (from the load-from-Suite pack, its Q1)
- **Context:** the panel needs an engagement. Suite exposes no staff-scoped list
  endpoint; its route accepts an engagement id or slug.
- **Default chosen:** a typed "Engagement id or slug" field and a Load button. The
  old list call (`/api/assist/engagements?form=`) and export call are removed.
- **Alternative:** add a list route to Suite and bring the picker back.
- **Answer:**

## Q27 — Required fields Suite does not supply
- **Context:** `validatePayloadForForm` refused a payload missing any required
  `sourceField`. Suite's contract omits what it does not hold (Part A: sub-category),
  so every real engagement would be refused.
- **Default chosen:** for a payload that came with Suite's `missing` list, the gap is a
  warning on panel 2 naming each field; the run then reports each unfilled required
  field in the read-back diff. A flat payload (legacy bundle) is still refused.
- **Alternative:** mark such fields optional in the maps.
- **Answer:**

## Q28 — The development Suite origin is no longer granted at install
- **Context:** `http://localhost:3000/*` was a fixed host permission (Q1 default). The
  rule for this task is: permission at save time, never at install.
- **Default chosen:** removed from `host_permissions`. `http://localhost/*` stays in
  `optional_host_permissions` (Chrome match patterns ignore the port), so saving
  `http://localhost:3000` asks like any other origin.
- **Alternative:** keep the dev origin pre-granted.
- **Answer:**

## Q29 — Loads without a Suite version, result post path
- **Context:** the assist-profile route returns no `suiteVersion`; the result post
  still targets `/api/assist/engagements/{id}/result`, which Suite does not have.
- **Default chosen:** a profile payload carries `suiteVersion: ''` and raises no skew
  warning; `schemaVersion` alone gates (refused naming both versions). The result post
  is unchanged and will 404 until Suite builds it; the error names the origin.
- **Alternative:** add `suiteVersion` to Suite's route response.
- **Answer:**

## Q30 — Contract names vs field maps
- **Context:** Task: verify the names in `docs/00-profile-contract.md` against the
  generated maps and fix the maps, never the contract.
- **Default chosen:** `tools/build-fieldmaps.mjs` now checks every `sourceField` on each
  run. Result: every key the contract names that a map reads is spelled the same
  (Part A 7/7; Part B 237 fields; INC-33 1); no map field sits outside a contract
  section; nothing needed renaming. Contract keys no map reads: `company.nicDescription`
  (informational), `company.hasShareCapital` (mapping.js computes
  `havingShareCapitalOrNot` from it, see Q22), `directors[].index`, `lastName` (the
  contract's alternative to `surName`), `kind` / `isDirector` (inputs to the block
  split). Paths the contract does not name (AGILE, MoA / AoA leaves, subscriber and
  address parts) are Assist-only; Suite never sends them, so they stay unfilled. A real
  Suite-built profile bound through `src/suite/profile.js` fills Part A 6 of 7 fields.
- **Alternative:** make the check fail on any unnamed path.
- **Answer:**

## Q31 — Form container selector for the waitFor step (consolidation pack Q1)
- **Context:** `docs/consolidation/docs/03-recipes.md` says take the form container
  from the captured schema; if none is stable, a fallback is needed.
- **Default chosen:** see the P4 entry — the first mandatory field's `guideFieldNode`.
- **Alternative:** wait on the AEM `guideContainer` root, which may exist before the
  form's fields render.
- **Answer:**

## Q32 — Unbound schema fields (consolidation pack Q2)
- **Context:** many captured fields have no `mapping.js` binding, especially Part B.
- **Default chosen:** emitted with `sourceField: null`, `optional: true`, so they are
  visible and bindable later without a recapture. Panel 2 counts them but does not
  list them; the engine never fills them.
- **Alternative:** omit them, keeping the field maps small.
- **Answer:**

## Q33 — Part A has 42 entries, not ~105
- **Context:** the acceptance list expects ~105 entries for Part A. `schemas-full`
  counts every captured AEM node: 39 text blocks and 23 buttons are not inputs, and one
  is a file upload.
- **Default chosen:** a field map lists inputs only (42 for Part A). A button in a fill
  map would be a click target with no guard context; text blocks take no value. The
  per-form summary prints what was left out and why.
- **Alternative:** list every node, with non-inputs marked unfillable.
- **Answer:**

## Q34 — mapping.js keys were truncated
- **Context:** eight bindings in `legacy/extension/lib/mapping.js` (four in Part B, four
  in AGILE-PRO-S) were cut at 34 characters, e.g. `totalUnclassifiedAuthorizedShareCa`
  for `totalUnclassifiedAuthorizedShareCapitalMandatory`. No portal field has those
  classes, so the reference build never filled them. The generator's drift check
  stopped on them, as it must.
- **Default chosen:** corrected the eight keys in mapping.js to the captured names (the
  file stays the authority, now a correct one). Logged in `legacy/README.md`.
- **Alternative:** an alias table in the generator, leaving mapping.js untouched.
- **Answer:**

## Q35 — OTP inputs in the capture
- **Context:** Part B and AGILE-PRO-S have OTP entry fields (`enterOTP_Mobile_4A`,
  `MobileOTP`, …). The loader refuses any map naming a credential-like field.
- **Default chosen:** the generator leaves them out (counted in the summary) and would
  stop if mapping.js ever bound one.
- **Alternative:** none — OTP is the lead's.
- **Answer:**

## Q36 — The SPICe+ information pop-up is no longer clicked
- **Context:** the earlier Part A recipe waited for and clicked `#okInfoModalBtn`. The
  revised pack's recipe is navigate → wait for the form → fill → halt, with no other
  clicks.
- **Default chosen:** dropped. Fills set values directly, so the modal overlay does not
  block them; the lead closes it. If it turns out to block the form's scripts, add the
  captured `#okInfoModalBtn` click back after the navigate step.
- **Alternative:** keep the captured click (fails the run if MCA stops showing it).
- **Answer:**

## Q37 — The result-recipe stub is gone
- **Context:** "no `.example` file remains in `recipes/`". The return leg (read the SRN
  after submission) only had `spice-part-a.result.example.json`; no SRN selector was
  captured.
- **Default chosen:** deleted. Panel 5's "Read SRN" now reports that no result recipe
  exists for the form. Capture the post-submit page to write a real one.
- **Alternative:** keep the stub as an exception.
- **Answer:**

## Q38 — Forms other than Part A are enabled
- **Context:** recipes and maps now exist for all six forms; only Part A must work first.
- **Default chosen:** all six are selectable in panel 1, labelled "not yet tried on the
  portal" (INC-9: "nothing bound yet"). The one button runs Part A only.
- **Alternative:** keep them disabled until each is exercised.
- **Answer:**

## Q39 — waitFor targets per form (answers Q31)
- **Default chosen:** the first mandatory captured input outside a repeat panel,
  whatever its capture-time `disabled` state (prefilled fields still render): Part A
  `type-of-company`, Part B `aoaEntrenched`, AGILE `block1-companyName`, INC-33
  `tableApplicableToCompany`, INC-34 `serial_number`, INC-9
  `nonIndSubWithPANDeclaration1` (may be conditional; INC-9 is unbound anyway). No
  stable `guideContainer` id was used: it can exist before the fields render.
- **Answer:**
