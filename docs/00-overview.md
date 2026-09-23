# 00 — Overview

## What VCFO Assist is

A Chrome MV3 extension that removes double data entry. Engagement data already
exists in VCFO Suite. Today a Project Lead retypes it into the MCA V3 portal.
Assist reads it from Suite and fills the portal form, leaving every act that
requires a human to the human.

It is a companion to VCFO Suite, shipped with it, versioned with it. Not a
standalone product and not licensed separately.

## The one flow it must support first

1. Lead opens the MCA portal. Assist's side panel is open beside it.
2. Lead logs in and clears the captcha. Assist does nothing.
3. Lead clicks "Fill SPICe+ Part A".
4. Assist navigates: MCA Services, Company e-Filing, Incorporation & Changes,
   SPICe+, the name reservation form.
5. Assist fills every field it has data for, then stops.
6. Lead reviews, then submits. Assist does not submit.

Everything else — Part B, linked forms, resubmission, status capture — comes
later and reuses the same engine.

## Why the engine is generic

The MCA DOM has not been captured yet. Rather than wait, the automation is
expressed as data: a recipe of ordered steps, and a field map binding each portal
field to a Suite value. The engine that executes them is site-agnostic and can be
built now. When the capture arrives it becomes two JSON files.

A second form is then a new JSON file, not a new code path.

## What it never does

Login, captcha, OTP, DSC signing, payment, final submission. Those belong to the
human for the reasons in `docs/06-human-boundary.md` — permanently, not as a
temporary limitation.

## Relationship to the desktop plan

The desktop version agreed earlier is unchanged except in technology: same
five-panel wizard, same VCFO Suite visual language, same human boundary, same
round trip back to Suite, same one-engagement-at-a-time scope. The extension
replaces Tauri and Playwright. Nothing about the product changed.
