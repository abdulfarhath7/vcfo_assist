# legacy/ — the reference build

`legacy/extension/` is the original popup build of VCFO Assist. It is the
**reference build**: it knows the real MCA portal and fills SPICe+ forms today.
It is kept until the side-panel build at the repository root has filled a real
SPICe+ Part A form on the live portal. Then it can be deleted.

Its manifest is renamed to `manifest.json.disabled` so it cannot be loaded by
accident: two loaded extensions would both claim `www.mca.gov.in`. To run it for comparison, copy the folder out,
rename the file back to `manifest.json`, and load that copy unpacked.

## Source of truth for MCA field knowledge

`extension/lib/mapping.js` is the source of truth for what Assist knows about MCA
fields: which AEM semantic key (the class MCA puts on each `.guideFieldNode`, e.g.
`proposedname1`, `type-of-company`, `din7a`) takes which profile value, which
fields wait for their options to load, which carry a note for the lead, and how
repeat-panel instances are numbered. `extension/schemas/*.compact.json` are the
captured field schemas (label, type, length, options) that go with it.

The root build does not copy this knowledge by hand. `tools/build-fieldmaps.mjs`
reads `mapping.js` and `schemas-full/*.json` and generates `fieldmaps/<form>.json`. When MCA
changes, fix `mapping.js` (or re-capture a schema), then regenerate:

```
node tools/build-fieldmaps.mjs
```

`extension/content/filler.js` is the authority on how a semantic field key resolves
to an input, including repeat-panel instances; the root build ports that as the
`guideFieldNode` selector strategy in `src/content/lib/resolve.js`.

`schemas-full/` (repository root) is shared input for the generator, not part of
either build.

## Changes made here since the move

- 2026-09-23: eight keys in `lib/mapping.js` were truncated at 34 characters
  (`totalUnclassifiedAuthorizedShareCa`, `block1-premisesEstablishmentIsOwne`, …) and
  matched no field on the portal, so they never filled in this build either. They
  now carry the full captured names. Found by `tools/build-fieldmaps.mjs`'s drift
  check against `schemas-full/`.
