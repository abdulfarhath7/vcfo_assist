# 07 — Privacy and data handling

The payload contains directors' PAN, DIN and passport data, including foreign
nationals. Treat it accordingly.

## Storage

- Engagement data, run state, and diffs live in `chrome.storage.session`. That
  store is cleared when the browser closes and is never written to disk by the
  extension.
- `chrome.storage.local` holds preferences only: Suite origin, last used form,
  panel collapse state. No engagement data, no field values, ever.
- On `halt`, `aborted`, or `failed`, clear the engagement payload from session
  storage once the result has been posted or the lead dismisses the run.

## Display

Values are shown in exactly two places: panel 2 (verify) and the mismatch rows of
panel 3. Both are on-screen only. They do not appear in the header, the step list,
the run log, or any error string. An error names the field key, never the value.

## Logging

No `console` output containing a field value, an engagement name, or any part of
the Suite payload. Counts, keys and selectors only. This applies in development
builds too — a debug line left in is how PII reaches a support screenshot.

## Transport

The only outbound requests are to the configured Suite origin. `host_permissions`
lists that origin and `mca.gov.in`, nothing else. No analytics, no error reporting
service, no remote fonts or scripts.

## Bundle files

The `.vcfoa` fallback is decrypted into session storage and the file contents are
discarded immediately. Assist never writes a bundle to disk, never caches one, and
refuses one past its `expiresAt`.

## What the extension must never do

- Persist engagement data across a browser restart
- Write any captured or fetched value to a file
- Send anything to an origin other than Suite
- Log a value in any form, including a redacted length
