# legacy/ — the reference build

`legacy/extension/` is the original popup build of VCFO Assist. It is the
**reference build**: it knows the real MCA portal and fills SPICe+ forms today.
It is kept, unchanged, until the side-panel build at the repository root fills a
real SPICe+ form end to end. Then it can be deleted.

Its manifest is renamed to `manifest.json.disabled` so it cannot be loaded by
accident next to the root build. To run it for comparison, copy the folder out,
rename the file back to `manifest.json`, and load that copy unpacked.

## Source of truth for MCA field knowledge

`extension/lib/mapping.js` is the source of truth for what Assist knows about MCA
fields: which AEM semantic key (the class MCA puts on each `.guideFieldNode`, e.g.
`proposedname1`, `type-of-company`, `din7a`) takes which profile value, which
fields wait for their options to load, which carry a note for the lead, and how
repeat-panel instances are numbered. `extension/schemas/*.compact.json` are the
captured field schemas (label, type, length, options) that go with it.

The root build does not copy this knowledge by hand. `tools/build-fieldmaps.mjs`
reads `mapping.js` and the schemas and generates `fieldmaps/<form>.json`. When MCA
changes, fix `mapping.js` (or re-capture a schema), then regenerate:

```
node tools/build-fieldmaps.mjs
```

`extension/content/filler.js` is the reference for how a semantic key resolves to
an input, including repeat-panel instances; the root build ports that as the
`guideFieldNode` selector strategy in `src/content/lib/resolve.js`.
