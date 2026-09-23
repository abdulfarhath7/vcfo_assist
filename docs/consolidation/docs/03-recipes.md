# 03 — Recipes, by direct navigation

## The navigate op

Add `navigate` to the engine if it does not exist:

```jsonc
{ "op": "navigate", "url": "https://www.mca.gov.in/…/spice.html", "label": "SPICe+ Part A" }
```

- `chrome.tabs.update` on the run's tab, then wait for load complete
- **Refused unless the URL's origin is exactly `https://www.mca.gov.in`.** The guard
  enforces this; a recipe cannot navigate anywhere else
- Times out like any other step, reporting the URL and elapsed time

## Recipe shape

Generated per form from `schemas-full/index.json`, which holds each form's URL.

```jsonc
{
  "id": "spice-part-a",
  "version": 1,
  "label": "SPICe+ Part A — name reservation",
  "origin": "https://www.mca.gov.in",
  "requiresFieldMap": "spice-part-a",
  "preconditions": [
    { "op": "assertLoggedIn", "selector": "#welcomeUser",
      "message": "Log in to MCA first. VCFO Assist does not log in for you." }
  ],
  "steps": [
    { "op": "navigate", "url": "https://www.mca.gov.in/content/mca/global/en/mca/e-filing/incorporation-change-services/spice.html", "label": "Open SPICe+ Part A" },
    { "op": "waitFor", "selector": "…form container…", "timeoutMs": 30000, "label": "Form rendered" },
    { "op": "fillGroup", "section": "all", "label": "Fill Part A" },
    { "op": "halt", "reason": "Review every field, pick the NIC row, then submit yourself." }
  ]
}
```

**No menu clicking. No `humanGate` for navigation. No guessed selectors.**

Generate one per form: `spice-part-a`, `spice-part-b`, `agile-pro-s`, `inc-9`,
`inc-33-emoa`, `inc-34-eaoa`. Part A is the one that must work first; the rest may
land unexercised.

## The form container selector

Take it from the captured schema rather than inventing one — the AEM guide container
id is in `schemas-full/<form>.json`. If no stable container is identifiable, wait on
the first mandatory field's `guideFieldNode` instead, and note it in `QUESTIONS.md`.

## What the recipe must never contain

A `submit` step, a payment step, a signing step, or a step that clicks anything
matching the danger set. The guard refuses these regardless, and a recipe that tries
is a bug to be reported loudly, not worked around.
