# 10 — Deferred until the DOM is captured

Nothing in `docs/00` to `docs/09` waits on the MCA capture. This is the list that
does.

## Produced from the capture, not written by hand

1. `recipes/spice-part-a.json` — the real navigation path: MCA Services, Company
   e-Filing, Incorporation & Changes, SPICe+, the name form. Selectors come from
   the Flowprint `flow-map.json`, ordered by its transition graph.
2. `fieldmaps/spice-part-a.json` — every Part A control with its ranked selectors,
   `entry.mode`, dependencies and `loadingSelector`, bound to Suite `sourceField`
   names by hand.
3. `recipes/spice-part-a.result.json` — where the SRN appears after submission,
   for the return leg.

## Capture requirements specific to this

When recording the walkthrough:

- Hit **Capture now** once the AEM adaptive form has rendered. The first export
  captured the login page before its form existed, which is why it contains only
  the theme toggle and search box.
- Walk the full menu path with clicks, so the transition graph holds the
  navigation, not just the destination.
- Change the state, district and NIC dropdowns so the dependency edges are
  recorded, and note the loading indicator that appears between them.
- Trigger at least three validation errors.
- Resume an existing application by SRN so the re-entry path is captured — the
  recipe needs both a fresh-start and a resume entry point.

## Known unknowns the capture must answer

- Whether the SPICe+ form is same-page or a separate origin or iframe. If it is a
  cross-origin frame, `host_permissions` and the content-script matches change.
- Whether the form is AEM adaptive forms throughout, or Angular on the inner
  pages. The login capture says jQuery 3.5.1 plus AEM; the inner forms may differ,
  and `setvalue.js` already handles both.
- Whether navigation is real page loads or in-page routing, which decides between
  `waitForUrl` and `waitFor`.
- Whether any control sits in a shadow root, which decides whether `shadowPath` is
  exercised at all.

## Follow-on work, after the first form runs

- Part B and the linked forms: AGILE-PRO, INC-9, MOA, AOA. New JSON files, same
  engine.
- Resubmission flow, which reuses the resume entry point.
- Status capture as a standalone recipe, so the lead can read SRN state without a
  fill run.
