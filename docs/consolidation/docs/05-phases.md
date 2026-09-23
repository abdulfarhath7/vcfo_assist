# 05 — Phases

Five phases, one run. `npm run check` passes at the end of each. Commit per phase.

## P1 — Retire the popup build
`extension/` → `legacy/extension/`, manifest disabled, `legacy/README.md` written.
Root `manifest.json` references nothing under `legacy/`.

## P2 — Port the addressing scheme
Read `legacy/extension/content/filler.js`. Add the `guideFieldNode` strategy to
`src/content/lib/resolve.js` alongside the CSS path. Resolution rules unchanged:
exactly one visible match, or a named failure with candidate counts.

## P3 — Generate field maps
`tools/build-fieldmaps.mjs` per `docs/02-consolidation.md`. Commit the script and its
output for all six forms. Hard-fail on a `mapping.js` binding with no schema field.
Print the per-form summary. Delete the `.example` stubs.

## P4 — Generate recipes
Add the `navigate` op, origin-guarded to `https://www.mca.gov.in`. Generate one recipe
per form from `schemas-full/index.json` URLs. No menu clicking, no `humanGate` for
navigation.

## P5 — Suite wiring and the one button
`src/suite/client.js` fetches inside a Suite tab via `chrome.scripting.executeScript`.
Origin field with permission request at save time. Engagement preselected from an open
Suite tab. The **Start SPICe+ Part A** control driving the six-step flow in
`docs/04-suite-wiring.md`. Visible `missing` and `notes`. Specific failure messages.
Bundle import kept as a fallback, demoted.

---

## Done means

A lead opens VCFO Suite on an engagement, opens the side panel, clicks one button,
logs into MCA, clicks Continue, and watches 105 Part A fields fill — then reviews and
submits. Nobody retypes anything and nobody navigates a menu.
