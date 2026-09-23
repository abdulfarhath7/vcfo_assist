# 04 — Suite wiring and the one-button flow

Goal: the lead learns nothing. One button. Everything that can be automatic is.

## Fetching the profile — inside a Suite tab

Never fetch from the extension origin. A `fetch` from `chrome-extension://…` to
`app.sbctrack.in` is cross-site, so the Auth.js session cookie (`SameSite=Lax`) is
dropped and the route answers 401 from a browser that is plainly signed in.

Instead:

1. Find a tab on the configured Suite origin. If none, open one with
   `chrome.tabs.create({ active: false })` and wait for load complete.
2. `chrome.scripting.executeScript` into that tab, running a function that does
   `fetch('/api/engagements/' + id + '/assist-profile', { credentials: 'include' })`
   and returns the parsed JSON.
3. Close the tab afterwards **only if the extension opened it**.

Same-origin, so the cookie is sent and no CORS headers exist anywhere.

Permissions: declare the Suite origin under `optional_host_permissions` and request it
with `chrome.permissions.request` when the lead saves the origin — never at install,
because the origin differs per deployment. Ship `http://localhost:3000` and
`https://app.sbctrack.in` as the offered defaults.

## Zero-friction engagement selection

- If a Suite tab is open on an engagement page, parse the engagement id or slug from
  its URL and preselect it. Show the company name for confirmation.
- Only fall back to a typed id or slug when no engagement page is open.
- Do not build a picker. Record it in `QUESTIONS.md` if it seems necessary.

## The one button

A single primary control in the import view: **Start SPICe+ Part A**.

| Step | Who | What happens |
|---|---|---|
| 1 | extension | Load the profile as above; show company name and the `missing` list |
| 2 | extension | Open `https://www.mca.gov.in` in a new active tab if not already open |
| 3 | **lead** | `humanGate`: "Log in, clear the captcha and OTP, then click Continue" |
| 4 | extension | Run the recipe: navigate straight to the Part A URL, wait for the form |
| 5 | extension | Fill, then read back and show the verify diff |
| 6 | **lead** | Review, pick the NIC row, submit |

The lead touches four things: login, captcha, OTP, Continue — then review and submit.
Nothing else. No origin typing after first setup, no engagement picking when Suite is
already open on it, no menu clicking, no form navigation.

## Failure messages

Always specific, always with a way forward:

- 401 → "Sign in to VCFO Suite, then click Load again", with a button that focuses the
  Suite tab
- Permission refused → "Allow access to {origin} to load engagements"
- Network failure → "Could not reach {origin}. Check the address, or import a bundle
  instead"
- Schema mismatch → names both versions
- Selector failure → names the field key and every selector tried, with match counts

Never "something went wrong".

## Keep as fallback

`src/suite/bundle.js` stays, for a machine that cannot reach Suite. It moves below the
one-button control in the import view and is no longer the primary path.

## Binding profile values to fields

Field maps bind by `sourceField`, using the names in `docs/00-profile-contract.md`.
Verify the generator emitted those exact names. **If they disagree, fix the field maps
— never the Suite contract.** Suite owns that vocabulary.
