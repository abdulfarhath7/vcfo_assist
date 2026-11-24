# Mock GST registration portal

A local stand-in for `https://reg.gst.gov.in/registration/`, for the offline tests only
(`node tools/e2e-gst.mjs`). It is plain HTML and a little JavaScript, not the portal's
AngularJS app.

- **Part A** (`pages/part-a.html`) copies the ids, names, `maxlength`s and option values seen
  live on 2026-11-25 (`#applnType`, `#applnState`, `#applnDistr`, `#bnm`, `#pan_card`,
  `#email`, `#mobile`, `#captcha`, PROCEED). Districts load after the state, as live.
- **Part B tabs** copy the ids from the portal's own public templates
  (`/pages/registration/newrg/*.html`): they were never seen rendered, so the mock is only as
  right as those templates.
- Upload blocks mimic the portal's `data-file-model` directive: the file input stays disabled
  until a document type is chosen, and the size and type caps are the portal's
  (`/master/docsize`).
- Every click on a button or link and every form submit is reported to the server
  (`POST /__mock/event`) with `isTrusted`, so a test can prove VCFO Assist (untrusted, script
  clicks) never pressed PROCEED, Save & Continue, ADD NEW or a Submit button.
- The acknowledgement page carries a test ARN, `AA3611260012345`.

Run it by hand with `node tools/gst-mock-server.mjs` (GST mock on http://127.0.0.1:8765, a
stand-in Suite on http://127.0.0.1:8766). All data is invented.
