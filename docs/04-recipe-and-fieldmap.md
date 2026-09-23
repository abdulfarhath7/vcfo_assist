# 04 — Recipe and field map

The two files that carry all site-specific knowledge. Everything else in the
codebase is site-agnostic.

Both currently exist only as `.example.json` stubs. The real files are generated
from a Flowprint capture once the MCA DOM is recorded.

## Recipe

```jsonc
{
  "id": "spice-part-a",
  "version": 1,
  "label": "SPICe+ Part A — name reservation",
  "origin": "https://www.mca.gov.in",
  "requiresFieldMap": "spice-part-a",
  "requiresSchemaVersion": 1,
  "preconditions": [
    { "op": "assertUrlMatches", "pattern": "^https://www\\.mca\\.gov\\.in/",
      "message": "Open the MCA portal first" },
    { "op": "assertLoggedIn", "selector": "#welcomeUser",
      "message": "Log in to MCA before running this" }
  ],
  "steps": [
    { "op": "click", "selector": "…", "label": "MCA Services" },
    { "op": "click", "selector": "…", "label": "Company e-Filing" },
    { "op": "click", "selector": "…", "label": "Incorporation & Changes" },
    { "op": "click", "selector": "…", "label": "SPICe+" },
    { "op": "waitForUrl", "pattern": "spice", "timeoutMs": 30000,
      "label": "SPICe+ page" },
    { "op": "waitFor", "selector": "…", "timeoutMs": 20000,
      "label": "Form rendered" },
    { "op": "fillGroup", "section": "partA", "label": "Fill Part A" },
    { "op": "halt", "reason": "Review every field, then submit yourself" }
  ]
}
```

### Operations

| Op | Arguments | Behaviour |
|---|---|---|
| `click` | `selector`, `label` | Refused by the guard if the target is in the danger set. Scrolls into view first. |
| `fill` | `key`, `label` | One field from the map. |
| `fillGroup` | `section`, `label` | Every field in a map section, in map order, respecting `dependsOn`. |
| `select` | `key`, `label` | Native select or ARIA listbox, per the map's `entry.mode`. |
| `check` | `key`, `value` | Checkbox or radio. |
| `waitFor` | `selector`, `timeoutMs` | Element present and visible. |
| `waitForGone` | `selector`, `timeoutMs` | Loader disappeared. |
| `waitForUrl` | `pattern`, `timeoutMs` | URL matches. |
| `assert` | `selector`, `message` | Fails the run with `message` if absent. |
| `humanGate` | `message` | Pauses the run; panel shows the message; resumes on explicit click. |
| `halt` | `reason` | Ends the run cleanly. Always the last step of a fill recipe. |

No `submit` op exists. Do not add one.

### Dependent fields

`fillGroup` respects `dependsOn`. A field whose `dependsOn` is non-empty is filled
only after its sources are filled, and the engine waits for the dependent control
to settle — `waitForGone` on the map's declared `loadingSelector`, or a 400ms
quiet period if none is declared.

## Field map

```jsonc
{
  "id": "spice-part-a",
  "version": 1,
  "origin": "https://www.mca.gov.in",
  "framework": "jquery",
  "requiresSchemaVersion": 1,
  "capturedFrom": "flowprint-www.mca.gov.in-2026-09-16T2039",
  "sections": {
    "partA": [
      {
        "key": "proposedName1",
        "label": "Proposed name 1",
        "sourceField": "proposedName1",
        "optional": false,
        "type": "text",
        "maxLength": 120,
        "transform": "trim|upper",
        "entry": { "mode": "typed" },
        "selectors": {
          "primary": "#proposedName1",
          "fallbacks": ["[name=\"proposedName1\"]"],
          "shadowPath": [],
          "stability": "stable"
        },
        "dependsOn": [],
        "loadingSelector": null
      }
    ]
  }
}
```

### Rules

- `key` is Assist's identity for the field. `sourceField` is Suite's. They are
  allowed to differ and usually will.
- `transform` is a pipe-separated list from a fixed set: `trim`, `upper`, `lower`,
  `digitsOnly`, `dateDDMMYYYY`, `dateYYYYMMDD`. No arbitrary expressions.
- `entry.mode` is `typed`, `widget`, or `unknown`. `widget` fields are not typed
  into — the engine opens the control and picks an option, per `entry.widgetKind`.
  `unknown` is filled as `typed` and always verified.
- `optional: true` means a missing `sourceField` is a skip, not an error.
- `stability: "fragile"` is allowed but the panel warns before a run that includes
  one.

### Selector strategies

`selectors` takes one of two forms:

```jsonc
// css (default): primary, then each fallback, under shadowPath
"selectors": { "primary": "#proposedName1", "fallbacks": [], "shadowPath": [], "stability": "stable" }

// guideFieldNode: MCA's AEM Adaptive Forms put a semantic class on each
// .guideFieldNode (proposedname1, type-of-company, din7a). The field is the
// node with that class; the control is the input / select / textarea in it.
"selectors": { "strategy": "guideFieldNode", "key": "din7a", "instance": 1 }
```

`instance` (0-based) addresses a repeat-panel row, which all share one class.
Without it, exactly one visible node must carry the class. `stability` defaults to
`stable`. The strategy is the reference build's `legacy/extension/content/filler.js`
resolution, ported to `src/content/lib/resolve.js`.

Two optional field properties come with it: `waitForOptions: true` (the dropdown's
options load after an earlier choice or a PIN lookup, so the engine polls for the
exact option instead of failing at once) and `note` (shown to the lead in panel 2).
Transform `yesNo` turns Suite booleans into MCA's `Yes` / `No` radio answers.

### Generated maps

The real `fieldmaps/<form>.json` are generated, not hand-written:
`node tools/build-fieldmaps.mjs` reads `legacy/extension/lib/mapping.js` (the source
of truth for MCA field knowledge) and `legacy/extension/schemas/*.compact.json`.
Keys mapping.js computes rather than reads from one profile field (counts,
constants) are listed under `_skipped`; keys it writes twice under `_conflicts`.
Repeat-panel `sourceField`s name the portal block, e.g. `directors[withDin].0.din`.

## Versioning

Both files carry `version`. The engine records which versions ran, and the result
posted to Suite includes them. If `fieldmap.version` is behind the recipe's
`requiresFieldMap` version, refuse to run.

## Stubs (superseded)

Until 2026-09-23, `recipes/spice-part-a.example.json` and
`fieldmaps/spice-part-a.example.json` contained the shapes above with three placeholder fields and obviously fake
selectors, so the engine, validation and UI could be built before the capture.
They were deleted once the generated maps and the real Part A recipe existed. The
loader still refuses any file whose `id` ends in `.example` when the panel is not
in development mode (the `.result.example.json` stub remains).
