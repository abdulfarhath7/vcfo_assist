# 09 — Acceptance checklist

For the human, after the build. Claude Code does not run this. Most checks use the
example stubs and the fixture, since the real DOM has not been captured.

## Loads
- [ ] `npm install && npm run check` passes clean
- [ ] Load unpacked accepts the folder; no manifest or service-worker errors
- [ ] Toolbar icon opens the side panel beside a tab
- [ ] Panel renders in VCFO colours and fonts, light and dark

## Refuses correctly
- [ ] With no Suite origin set, the panel uses the fixture and says so
- [ ] A payload with the wrong `schemaVersion` is refused with a named reason
- [ ] A field map referencing a `sourceField` absent from the payload is refused,
      listing the missing keys
- [ ] The `.example` stub is refused outside development mode
- [ ] A recipe containing a `click` on a control matching the danger set fails the
      run and says why

## Runs against the stub
- [ ] Starting a run on a non-MCA tab fails the precondition with a clear message
- [ ] The step list advances, each step showing its label
- [ ] A selector that matches nothing stops the run and names the field and every
      selector tried
- [ ] A selector matching two elements stops the run rather than picking one
- [ ] Killing the service worker mid-run (toggle the extension off and on) resumes
      at the right step and does not replay the previous one

## Data handling
- [ ] Field values appear only in panel 2 and in panel 3 mismatch rows
- [ ] No value appears in the run log, any error string, or the console
- [ ] Engagement data is in `chrome.storage.session`, not `local` — check
      `chrome://extensions` service-worker devtools
- [ ] Closing and reopening the browser loses the engagement data, as intended

## Return leg
- [ ] Panel 5 previews exactly what will be sent
- [ ] Posting twice with the same SRN updates rather than duplicating

## Still pending
- [ ] Real recipe and field map, once the MCA DOM is captured
- [ ] An end-to-end run on the live portal
