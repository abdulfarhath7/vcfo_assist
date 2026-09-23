# 02 — Consolidation

## Step 1 — retire the popup build without losing it

```
extension/                    →  legacy/extension/
legacy/extension/manifest.json →  legacy/extension/manifest.json.disabled
```

Add `legacy/README.md`:

- this is the reference build, kept until the panel build has filled a real SPICe+
  Part A form on the live portal
- `legacy/extension/lib/mapping.js` is the authority on which profile value feeds
  which MCA field
- `legacy/extension/content/filler.js` is the authority on how a semantic field key
  resolves to an input
- the manifest is disabled so it cannot be loaded by accident, producing two
  extensions that both claim `mca.gov.in`

`schemas-full/` stays where it is. It is shared input for the generator, not part of
either build.

## Step 2 — port the addressing scheme, do not rewrite it

Read `legacy/extension/content/filler.js` first. It resolves a semantic key to an
input by looking at the classes on `.guideFieldNode` containers, and handles repeat
panels by instance.

Add that as a **selector strategy** in `src/content/lib/resolve.js`, beside the
existing CSS path. A field map entry may then say either:

```jsonc
"selectors": { "strategy": "guideFieldNode", "key": "proposedname1", "instance": 0 }
```

or the existing form:

```jsonc
"selectors": { "primary": "#…", "fallbacks": ["…"], "shadowPath": [] }
```

Keep both. The CSS form stays useful for pages that are not AEM Adaptive Forms.

Resolution rules do not change: exactly one visible match, or a named failure listing
every candidate and its match count. Never pick the first of several.

## Step 3 — generate field maps, do not type them

`tools/build-fieldmaps.mjs`, committed, reading:

- `schemas-full/*.json` — ids, keys, labels, types, `mandatory`, `widget`, `panels`,
  `panelIds`
- `legacy/extension/lib/mapping.js` — the `sourceField` bindings, `waitForOptions`,
  notes, instance handling, and the `person()` / `address()` groupings

Emitting `fieldmaps/<form>.json` for `spice-part-a`, `spice-part-b`, `agile-pro-s`,
`inc-9`, `inc-33-emoa`, `inc-34-eaoa`, each entry carrying:

```jsonc
{
  "key": "proposedname1",
  "label": "Proposed name 1",
  "sourceField": "company.proposedNames.0",
  "optional": false,
  "type": "text",
  "entry": { "mode": "typed", "widgetKind": null },
  "selectors": { "strategy": "guideFieldNode", "key": "proposedname1" },
  "dependsOn": [],
  "waitForOptions": false,
  "note": null
}
```

Rules for the generator:

- A schema field with no `mapping.js` binding is emitted with `sourceField: null` and
  `optional: true`. It is real and fillable, just not bound yet. Do not drop it.
- A `mapping.js` binding with no matching schema field is a **hard error** — print it
  and fail. That means the two sources have drifted and a silent skip would hide it.
- Carry `waitForOptions` and `note` through verbatim.
- Preserve `panels` / `panelIds` as `instance` support for repeat rows.

Print a summary per form: fields total, bound, unbound, notes carried.

Delete `fieldmaps/*.example.json` and `recipes/*.example.json` once real files exist.

## Step 4 — one manifest

The root `manifest.json` is the only live manifest. Confirm it does not reference
anything under `legacy/`.
