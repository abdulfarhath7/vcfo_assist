# START-HERE

Unzip into `apps/assist/` inside the VCFO Suite repo, open Claude Code there,
paste the prompt below.

---

```
Read CLAUDE.md first, then every file in docs/ in numerical order.

Build VCFO Assist completely — all phases P0 through P9 in docs/08-phases.md —
in this one session. Do not stop to ask me anything.

Rules that matter most:
- No tests, and do not try to run the extension. I test it manually.
- Run `npm run check` at the end of every phase; it must pass before you move on.
- Append to TASKS.md after every phase. Judgement calls go to QUESTIONS.md with
  your chosen default; keep going.
- The automation is data, not code. recipes/ and fieldmaps/ currently hold
  example stubs only. Never hardcode an MCA selector anywhere else.
- The engine never logs in, solves a captcha, signs with DSC, pays, or submits.
- Engagement data lives in chrome.storage.session, never local.
- UI matches VCFO Suite tokens and the five-panel flow in docs/02-ui-spec.md.

When you're done, print a summary of what you built and what's in QUESTIONS.md.
```

---

## After the DOM arrives

Nothing above gets rebuilt. I write the real `recipes/spice-part-a.json` and
`fieldmaps/spice-part-a.json` from the Flowprint capture, they replace the stubs,
and `docs/10-deferred.md` lists the small set of follow-up work.
