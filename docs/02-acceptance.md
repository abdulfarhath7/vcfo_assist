# 02 — Acceptance checklist

> Written for the popup build (now `legacy/extension/`). In the side-panel build, read
> "textarea / Preview" as panel 1 (Import) and panel 2 (Verify), and "paste" as the
> `.vcfoa` bundle import.

For the human, after the build. Load the folder unpacked at `chrome://extensions`.

## Nothing regressed
- [ ] Paste a profile into the textarea, click Preview — behaves exactly as before
- [ ] Import a profile from a file — behaves exactly as before
- [ ] Fill a SPICe+ Part A page from a pasted profile — fields land as before
- [ ] `git diff` shows no change to `mapping.js`, `filler.js` or `schemas/`

## The new path
- [ ] Saving a Suite origin requests permission for **that origin only**
- [ ] Declining the permission shows a message naming the origin, not a generic error
- [ ] Load from VCFO Suite fills the textarea with the same JSON the clipboard gives
- [ ] Preview afterwards lists the same values as the pasted path produced
- [ ] `missing` renders visibly, each line naming the field and the Suite step
- [ ] `notes` renders too — the NIC popup caveat must be readable

## Failures are specific
- [ ] Signed out of Suite: "Sign in to VCFO Suite in another tab, then try again"
- [ ] Wrong origin: names the origin and offers the paste fallback
- [ ] A `schemaVersion` the build doesn't know: refused, naming both versions

## Data handling
- [ ] `mcaLogin.userId` is empty after loading from Suite
- [ ] No MCA credential appears in storage, in the log, or in any request
- [ ] The profile is sent to no origin other than the MCA tab being filled
