# 04 — Assist side

> **Where this landed (2026-09-23).** This pack was written for the popup build, now
> `legacy/extension/`. It is implemented in the side-panel build instead:
> `src/suite/client.js` (fetch), `src/suite/profile.js` (validation and binding to field
> maps by `sourceField`), `src/sidepanel/views/import.js` (origin, engagement id, Load,
> missing / notes). The bundle import stays as the fallback; paste is not offered.

One change: where the profile comes from. Everything downstream is untouched.

## What stays exactly as it is

`extension/lib/mapping.js`, `extension/content/filler.js`,
`extension/schemas/*.compact.json`, `extension/schemas-full/`, and the existing paste
and file-import paths in the popup. If a diff touches `mapping.js`, it is wrong.

## What to add

### manifest.json

```json
"optional_host_permissions": ["https://*/*"]
```

The Suite origin is not known at install time — it differs per deployment. Request
the specific origin with `chrome.permissions.request` at the moment the user saves it,
never at install.

### popup.html

Above the existing profile textarea:

- A Suite origin input, saved to `chrome.storage.local` under `suiteOrigin`
- A "Connect" button that requests the host permission for that origin
- An engagement picker, populated after connecting
- A "Load from VCFO Suite" button

### popup.js

```js
const res = await fetch(`${suiteOrigin}/api/engagements/${id}/assist-profile`, {
  credentials: 'include',
});
```

The lead is already signed into Suite in the same browser; the cookie carries the
session. Then:

1. Check `schemaVersion`. If it is not one this build understands, stop and say so
   plainly, naming both versions.
2. Put `profile` into the existing textarea, JSON-stringified, so every existing
   path — Save, Preview, Fill — works unchanged.
3. Render `missing` as a list in the log area, each line naming the field and the
   Suite step that would fill it. Do not hide it behind an expander. A lead who
   cannot see what is missing will assume the form is complete.
4. Render `notes` the same way — the NIC popup caveat matters.

### Failure messages

Specific, always:

- `401` → "Sign in to VCFO Suite in another tab, then try again."
- Network failure → "Could not reach {origin}. Check the address, or paste the
  profile instead."
- Permission not granted → "Allow access to {origin} to load engagements."

Never "something went wrong".

## Engagement picker

If Suite exposes no list endpoint yet, accept a typed engagement id or slug and fetch
directly. A picker is nicer but is not worth blocking on — record the choice in
`QUESTIONS.md`.

## What Assist must never do

- Store, send, or prefill MCA credentials. `mcaLogin.userId` arrives empty and stays
  empty
- Send the profile anywhere other than the MCA tab it is filling
- Cache a profile beyond `chrome.storage.local`'s existing single-profile slot
- Submit, pay, or sign
