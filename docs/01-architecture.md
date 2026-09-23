# 01 — Architecture

## Placement

`apps/assist/` inside the VCFO Suite monorepo. Ships with Suite, versioned with
Suite, so the field map and the Suite export endpoint move together.

## Contexts

| Context | Role |
|---|---|
| Side panel (ES module) | The five-panel wizard. All user interaction. |
| Service worker (ES module) | Run orchestration, Suite API client, session state, step dispatch. |
| Content script (classic, `mca.gov.in` only) | DOM reads, fills, waits. Shares `window.__VA`. |

No offscreen document. No persistent MAIN-world script — the one MAIN-world need
(jQuery event triggering) is a per-call `chrome.scripting.executeScript`.

## File layout

```
manifest.json  jsconfig.json  package.json
CLAUDE.md  TASKS.md  QUESTIONS.md  README.md
docs/
recipes/    <form>.json          # stubs now, real files later
fieldmaps/  <form>.json          # stubs now, real files later
fixtures/   engagement.json      # development payload
src/
  shared/
    constants.js     # storage keys, message types, timeouts, danger set
    schema.js        # JSDoc typedefs: Recipe, Step, FieldMap, RunState, Diff
    result.js        # Ok/Err helper used by every fallible function
  suite/
    client.js        # fetch engagement export, post result
    bundle.js        # .vcfoa import fallback
    validate.js      # schema and version checks for both paths
  engine/
    runner.js        # executes a recipe step by step, owns RunState
    ops/             # one file per op: waitFor, click, fill, fillGroup, assert…
    guard.js         # danger-control refusal, human-gate enforcement
    verify.js        # read-back diff after a fill
  content/
    bridge.js        # message handler; installs nothing until asked
    lib/
      resolve.js     # selector resolution incl. fallbacks and shadowPath
      setvalue.js    # framework-aware value setting
      observe.js     # waitFor / waitForGone / waitForUrl primitives
  sidepanel/
    panel.html  panel.css  panel.js
    views/           # one file per wizard panel
```

## Run lifecycle

```
panel: "Fill SPICe+ Part A"
  → worker loads recipes/spice-part-a.json + fieldmaps/spice-part-a.json
  → worker validates map version against the Suite payload schemaVersion
  → worker fetches engagement data (Suite API, or imported bundle)
  → runner executes steps, dispatching each to the content script
  → after fillGroup, verify.js reads values back and produces a Diff
  → runner halts at the `halt` step
  → panel shows the diff, then the human gate
  → human reviews, signs, pays, submits
  → panel "Capture result" → content script reads SRN → worker posts to Suite
```

`RunState` is persisted to `chrome.storage.session` after every step, because the
MV3 worker terminates after roughly 30 seconds idle and a fill run contains long
waits. On wake, resume from the last completed step index. Never replay a completed
step — a replayed `click` is a second navigation.

## Value setting — the thing that silently fails

The captured MCA login page reports **jQuery 3.5.1 with AEM Forms**, not Angular.
Assigning `el.value` sets the DOM property but leaves the framework's model
untouched, so the portal submits an empty field while the screen shows text.

`setvalue.js` must, in order:

1. Use the native property setter
   (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`),
   so any framework value tracker is bypassed.
2. Dispatch `input`, then `change`, then `blur`, each `{ bubbles: true }`.
3. When the page has jQuery, trigger its handlers too. The content script is in the
   isolated world and cannot see page globals, so use
   `chrome.scripting.executeScript` with `world: "MAIN"` for this one call.
4. Read the value back. If it did not stick, report a failure for that field.

Step 4 is not optional. Never assume a fill worked.

## Storage

- `chrome.storage.session` — engagement data, run state, diffs. Cleared on browser
  close. Holds PII; never `local`.
- `chrome.storage.local` — preferences only: Suite origin, last used form, panel
  state. Never engagement data.

## Key trade-offs

- **Data-driven automation** costs an interpreter; buys a build that starts before
  the DOM exists, and a second form that costs one JSON file rather than a code
  path.
- **No bundler** costs some duplication; buys a folder that loads unpacked with no
  build step.
- **Session storage** costs a re-fetch after a browser restart; buys PII that never
  touches disk.
- **One engagement at a time** costs batching; matches how the work is actually
  done and removes a large amount of state handling.
