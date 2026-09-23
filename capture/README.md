# MCA portal capture (vCFO Assist research)

Recorder: `node recorder.js [startUrl]` — headed Chromium, persistent profile (`profile/`, keeps MCA login).
Stop: close browser window or `kill $(cat recorder.pid)`.

Output per run: `steps/<run-id>/`
- `NNNN/page.html`      full DOM of main frame at that step
- `NNNN/frame-N.html`   DOM of each iframe
- `NNNN/elements.json`  interactive elements: id/name/formcontrolname/label/placeholder/value/options/css/xpath/box
- `NNNN/screenshot.png` full-page screenshot
- `NNNN/meta.json`      url, title, reason (navigate/click/change/mutation/tick), headings
- `events.jsonl`        user actions (click/change/submit/key/navigate) + capture markers, in order
- `network.jsonl`       XHR/fetch/document requests + JSON responses (cookies/auth headers dropped, password/otp/captcha fields redacted)
- `downloads/`          any files downloaded (PDF forms etc.)

Steps are deduped by DOM hash; a new step is written only when the DOM actually changed.
