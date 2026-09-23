# 03 — VCFO Suite integration

Two paths into the extension, one path back. Both inbound paths produce the same
validated object, so the engine never knows which was used.

## Path A — live fetch (primary)

The lead is signed into Suite in the same browser. Assist fetches with the
existing cookie session.

```
GET {suiteOrigin}/api/assist/engagements/{id}/export?form=spice-part-a
credentials: "include"
```

`suiteOrigin` is configured once in the panel and stored in
`chrome.storage.local`. It must be in `host_permissions`. Ship with the
development origin and allow the user to change it.

Response:

```jsonc
{
  "schemaVersion": 1,
  "suiteVersion": "2026.09.1",
  "form": "spice-part-a",
  "engagement": { "id": "eng_123", "companyName": "…", "stage": "pre-inc" },
  "fields": { "proposedName1": "…", "state": "TG", "nicCode": "62011" },
  "issuedAt": "ISO-8601"
}
```

`fields` keys match `sourceField` names in the field map. Suite owns that
vocabulary; Assist never invents a key.

Auth failures are explicit: a 401 shows "Sign in to VCFO Suite in another tab,
then retry", not a generic error.

## Path B — bundle import (fallback)

For a machine that cannot reach Suite. Suite exports a `.vcfoa` file, the lead
picks it in panel 1.

- Same JSON payload, AES-GCM encrypted, passphrase shown once in Suite
- Manifest carries `issuedAt` and `expiresAt`; refuse anything past expiry
- Never written to disk by Assist. Decrypt into `chrome.storage.session` and
  discard the file handle

## Validation, both paths

`suite/validate.js` refuses to proceed unless:

1. `schemaVersion` is one the build understands
2. `form` matches the selected recipe
3. The field map's `requiresSchemaVersion` is satisfied
4. Every `sourceField` referenced by the map exists in `fields`, or is marked
   optional in the map

Failure is a named panel error listing the missing keys. Never partial-fill from a
payload that failed validation.

## Version skew

If `suiteVersion` is newer than the extension's pinned `compatibleSuite` range,
refuse and tell the lead to update Assist. Filling from a payload whose shape you
do not understand is worse than not filling.

## Path back

```
POST {suiteOrigin}/api/assist/engagements/{id}/result
{
  "form": "spice-part-a",
  "srn": "…",
  "status": "submitted",
  "capturedAt": "ISO-8601",
  "fieldsWritten": 34,
  "mismatches": []
}
```

Suite writes this into the engagement's `checklist_state` for the relevant step.
Idempotent on `{engagementId, form, srn}` — a repeated post updates, never
duplicates.

## Development without Suite

Until those endpoints exist, `suite/client.js` reads `fixtures/engagement.json`
when `suiteOrigin` is unset. Same shape, same validation path. This is a fixture,
not a mock layer — one file, no branching logic beyond the origin check.
