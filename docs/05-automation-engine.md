# 05 — Automation engine

## Runner

`engine/runner.js` owns `RunState`, persisted to `chrome.storage.session` after
every step:

```jsonc
{
  "runId": "run_…",
  "recipeId": "spice-part-a", "recipeVersion": 1, "fieldMapVersion": 1,
  "engagementId": "eng_123",
  "tabId": 12,
  "stepIndex": 4,
  "status": "running" | "paused" | "halted" | "failed" | "aborted",
  "startedAt": "…",
  "stepResults": [{ "index": 0, "op": "click", "label": "…", "ok": true, "ms": 240 }],
  "diff": null,
  "error": null
}
```

Persisting per step matters: the MV3 worker terminates after roughly 30 seconds
idle, and a fill run has long waits. On wake, resume at `stepIndex`. Never replay a
completed step — a replayed `click` is a second navigation.

## Step dispatch

The worker sends `{ type: "op", op, args, runId }` to the content script in the
run's tab. The content script executes and replies `{ ok, value?, error? }`.
Timeouts are owned by the worker, not the content script, so a dead content script
surfaces as a timeout rather than a hang.

If the tab navigates mid-run, the content script is destroyed. The worker detects
this via a failed send, waits for `chrome.tabs.onUpdated` status `complete`, then
re-sends the current step once. Two consecutive failures fail the run.

## Selector resolution

`content/lib/resolve.js`, given a `selectors` object:

1. Walk `shadowPath` hosts in order, descending into each `shadowRoot`
2. Try `primary`; if it matches exactly one visible element, use it
3. Try each fallback in order, same rule
4. Zero matches, or more than one after all candidates: fail with the field key,
   every selector tried, and each one's match count

Never pick the first of several matches. Ambiguity is a failure.

## Filling

`content/lib/setvalue.js`, per `docs/01`:

1. Native property setter
2. Dispatch `input`, `change`, `blur`, all bubbling
3. jQuery trigger via `chrome.scripting.executeScript` with `world: "MAIN"` when
   the page has jQuery — the captured MCA login page reports jQuery 3.5.1, so this
   path is the expected one, not an edge case
4. Read the value back and compare

Widget-mode fields skip 1 to 3: click the control, wait for the listbox, click the
option whose text or value matches, then verify the control's displayed value.

## Verification

`engine/verify.js` runs after every `fillGroup` and produces a Diff:

```jsonc
{
  "checked": 34, "matched": 32,
  "mismatches": [
    { "key": "nicCode", "expected": "62011", "actual": "", "reason": "value did not stick" }
  ],
  "skipped": [{ "key": "pan2", "reason": "optional, no source value" }]
}
```

A mismatch never triggers an automatic retry beyond one re-attempt of that single
field. Repeated silent retries are how a wrong value ends up in a statutory filing.

## Failure taxonomy

| Class | Example | Behaviour |
|---|---|---|
| Precondition | Not logged in | Refuse to start, name the precondition |
| Resolution | Selector matched 0 | Stop, name field and selectors tried |
| Ambiguity | Selector matched 3 | Stop, same |
| Timeout | `waitFor` expired | Stop, name selector and elapsed time |
| Verification | Value did not stick | Continue the group, collect in the diff, block panel 3's continue |
| Guard refusal | Recipe tried a danger control | Fail the run, log it loudly, treat as a recipe bug |
| Transport | Content script gone | One retry after tab settles, then fail |

Every message names the field key and the selector. "Automation failed" is not an
acceptable string anywhere.

## Logging

A run log is kept in memory and shown in the panel. It records op, label, outcome
and duration. **It never records a field value**, not even a redacted length. The
value appears only in panel 2 and in the diff on panel 3, both of which are on
screen and not persisted beyond the session.
