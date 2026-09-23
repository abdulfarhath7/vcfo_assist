# CLAUDE.md — build rules for VCFO Assist

You are building **VCFO Assist**, a Chrome MV3 extension that pre-fills the MCA
V3 portal from engagement data held in VCFO Suite. It is a companion to VCFO
Suite, not a standalone product.

Read `docs/` in order before writing code. `docs/04-recipe-and-fieldmap.md` and
`docs/06-human-boundary.md` are the contract.

## Central design decision

**The automation is data, not code.** The engine ships now; the site-specific
knowledge arrives later as two JSON files per form:

- `recipes/<form>.json` — the ordered steps to reach and fill a form
- `fieldmaps/<form>.json` — each field's selectors and where its value comes from

Both are currently **stubs with example shapes only**. The real MCA DOM has not
been captured yet. Build the engine, the UI, and the Suite integration against
the stubs. When the real files land, they drop in and nothing is rewritten.

Never hardcode an MCA selector in engine or UI code. Every selector comes from a
field map or recipe at runtime.

## How to work

- Build **all phases in `docs/08-phases.md` in one run**, without stopping.
- Do **not** write tests. Do **not** try to run the extension. The human tests it
  manually.
- **Do** run `npm run check` at the end of every phase. It must pass before the
  next phase starts.
- After each phase, append a dated entry to `TASKS.md`.
- Judgement calls go in `QUESTIONS.md` with your default and the alternative.
  Never block.

## Hard rules — never violate

1. **Human boundary.** The extension never performs login, captcha, OTP, DSC
   signing, payment, or final submission. The step engine refuses to click any
   control matching the danger set, and a recipe cannot override that refusal.
   See `docs/06-human-boundary.md`.
2. **No credential storage.** MCA credentials are never read, stored, filled, or
   logged. The user types them.
3. **Engagement data is session-scoped.** It lives in `chrome.storage.session`,
   never `local`. It contains director PAN, DIN and passport data.
4. **Fail loud.** A selector that does not match, matches more than one element,
   or fills a value that does not read back is a visible error in the panel. It is
   never retried silently and never skipped quietly.
5. **No network egress except VCFO Suite.** No analytics, no CDN, no remote fonts.
6. **UI matches VCFO Suite.** Same tokens, same component language, same five-panel
   flow agreed for the desktop version. Only the technology changed.

## Style

- Plain JavaScript with JSDoc types. devDependencies: `typescript`,
  `@types/chrome`. No bundler, no build step — loads unpacked.
- Service worker and side panel are ES modules. Content scripts are classic
  scripts sharing `window.__VA`.
- JSDoc on every exported function and shared type.
