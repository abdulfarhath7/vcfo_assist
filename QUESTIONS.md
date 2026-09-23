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
