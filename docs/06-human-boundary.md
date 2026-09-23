# 06 — The human boundary

This is the rule the whole product is shaped around. It is not a limitation to be
engineered away later.

## What the human always does

Login. Captcha. OTP. DSC signing. Payment. Final submission.

The legal position depends on these staying with the person: the account holder
authorises access, a human solves the security control, the signature is applied by
its holder, and the filing act with its professional certification is a human act.
Automate any one of them and the character of the tool changes.

## How the code enforces it

**Guard.** `engine/guard.js` refuses a `click` whose target matches the danger set,
regardless of what the recipe says. A recipe cannot opt out; there is no flag.

Danger set — matched against the element's text, `value`, `id`, `name`, `aria-label`
and `type`:

```
type="submit"
/submit|pay|payment|confirm|proceed to pay|file|final|sign|dsc|delete|remove/i
```

False positives are acceptable. If a legitimate navigation control is caught, the
recipe uses a different selector or inserts a `humanGate` step so the lead clicks
it. Widening the guard to make a recipe work is a rejected change.

**No submit op.** The operation does not exist in the engine. Adding one is a
change that requires the owner's explicit decision, not a developer's.

**No credential handling.** Assist never reads, stores, fills, or logs an MCA user
id, password, OTP or captcha. Fields matching
`/captcha|otp|passw|passcode|mpin|(?:^|[^a-z])pin(?![\s_-]*code)|secret|token|cvv/i`
are excluded from every field map and refused by the fill op even if one appears.

**Explicit gates.** Where the flow needs the human mid-run, the recipe uses
`humanGate` with a message. The run pauses until the lead clicks continue in the
panel. It does not time out and auto-continue.

## What the UI must never imply

No button labelled "Submit", "File", or "Complete filing". Panel 4's only control
is "I have submitted", which records that the human did it. Marketing copy says
"assisted filling", never "automatic filing".

## Failure mode to avoid

The dangerous version of this product is one that works so smoothly the lead stops
reading panel 2 and panel 3. Design against that: the verify table is not
collapsible on first run, mismatches are listed individually and in full, and
panel 4 states plainly that the filing and its certification are the lead's.
