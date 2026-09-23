# 02 — UI specification

A side panel, open beside the MCA tab. Five panels, advanced in order, matching
the desktop plan exactly.

## Visual language

Import the VCFO Suite token block. Inline in `panel.css` — no remote fonts, no
CDN, no Tailwind build.

```css
:root {
  --primary: #2563EB; --primary-hover: #1D4ED8;
  --bg: #F8FAFC; --surface: #FFFFFF; --border: #E2E8F0;
  --text: #0F172A; --text-muted: #64748B;
  --success: #0D9488;   /* done */
  --waiting: #F97362;   /* waiting on human */
  --lock: #94A3B8;      /* not yet reachable */
  --danger: #E11D48;    /* error, overdue */
  --radius: 0.875rem;
  --font-sans: Manrope, -apple-system, "Segoe UI", system-ui, sans-serif;
  --font-display: "Space Grotesk", var(--font-sans);
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
}
```

Fonts are bundled as woff2 in `assets/fonts/` and declared with `@font-face`, or
the stack falls back to system. Dark mode via `prefers-color-scheme` in the same
cool blue and slate family — never a warm invert. Body 15px, metadata 12px mono.
White text on the blue primary, never navy on blue. Status colour appears on chips
and icons only, never as page fill.

## The five panels

A progress rail runs down the left of the panel, one node per stage, using the
same states as Suite's `JourneyNode`: blue pulse for active, teal check for done,
coral clock for waiting on the human, slate for locked.

### 1. Import
- Engagement picker if Suite returned more than one; otherwise the engagement name
  as a serif display heading, matching Suite's company H1
- Source chip: "Live from VCFO Suite" or "Imported bundle"
- Form picker: which recipe to run. Only SPICe+ Part A is enabled at first
- Primary button: Continue

### 2. Verify
- A table of every field the map will fill: label, value, source field
- Values shown in full here — the lead must be able to check them. This is the
  only panel that displays engagement values
- Any field with no data shows a `--waiting` chip reading "no value"
- Edit is not offered. Wrong data is fixed in Suite, not here
- Primary button: Fill the form

### 3. Autofill
- Live step list from the recipe, each with its label, ticking over as it runs
- Current step highlighted with the blue pulse
- On completion, the read-back diff: per field, expected against what the page
  actually holds. Matches collapse to a count; mismatches list in full with
  `--danger` chips
- If a selector fails, the step stops and the panel names the field and the
  selector that missed. Never silently continue
- Primary button: Continue to review, disabled while a mismatch is unresolved
  unless the lead explicitly overrides with a confirm step

### 4. Sign, pay, file
- The human gate. A short checklist of what the lead does now, in their own hands:
  review every field, affix DSC, pay, submit
- A `--waiting` banner stating plainly that Assist will not do these
- No button that could be mistaken for "submit for me". The only control is
  "I have submitted"

### 5. Capture and return
- "Read SRN from page" button, which extracts what the result recipe defines
- Shows what will be sent back to Suite: SRN, status, timestamp
- Primary button: Send to VCFO Suite
- On success, a teal completion state and a "Start another form" reset

## Cross-cutting

- **Header** — VCFO wordmark, "Assist", version, and the connected Suite origin
- **Error surface** — a persistent slot above the primary button; errors are
  specific ("field `proposedName1`: selector `#pn1` matched 0 elements"), never
  "something went wrong"
- **No engagement values in the header, the step list, or any log.** Panel 2 and
  panel 5 only
- **Escape hatch** — an always-available "Stop" that aborts the run at the next
  step boundary and returns to panel 1
- Motion is restrained: the progress rail pulses, panels cross-fade. No modals, no
  celebration animation
