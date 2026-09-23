# 01 — What already exists, and what it's worth

## The capture — this is the asset

`schemas-full/index.json` lists seven captured forms, each with a **direct URL** and a
full field inventory:

| Form | Fields | URL path under `/content/mca/global/en/mca/e-filing/incorporation-change-services/` |
|---|---|---|
| spice-part-a | 105 | `spice.html` |
| spice-part-b | 1177 | `SpicePartB.html` |
| inc-9 | 286 | `INC-9.html` |
| agile-pro-s | 210 | `AgilePro.html` |
| inc-33-emoa | 128 | `INC-33.html` |
| inc-34-eaoa | 128 | `INC-34.html` |
| login | 41 | `/content/mca/global/en/foportal/fologin.html` |

Each field carries `id`, `key`, `label`, `type`, `semantic[]`, `mandatory`,
`disabled`, `widget`, `panels[]` and `panelIds[]`.

**The direct URLs remove the menu-navigation problem entirely.** There is no need to
click MCA Services → Company e-Filing → Incorporation & Changes → SPICe+. Navigate to
the URL. Do not write recipe steps that click menu items, and do not guess menu
selectors.

## `extension/lib/mapping.js` — the binding knowledge

219 lines mapping a client profile onto MCA field keys. It knows things the schema
dump does not:

- which profile value feeds which MCA field
- `waitForOptions` on fields whose options load after another field changes (`area`
  after `pincode`, `class-of-company`, `category-of-company`)
- notes such as the NIC row being picked from a popup table by hand, with
  `MainNICCode` read-only
- repeat-panel `instance` targeting for directors and subscribers
- `YN()` and `num()` coercion, and `person()` / `address()` field groups

This is the file to port from. It is the authority on *what goes where*.

## `extension/content/filler.js` — the addressing scheme

Resolves a semantic key — the class MCA's AEM Adaptive Forms put on each
`.guideFieldNode`, e.g. `proposedname1`, `type-of-company`, `din7a` — to an actual
input, including repeat-panel instances. Those keys are stable across repeat panels;
the numeric widget ids are not.

This is the mechanism to port. Read it before writing `docs/02`'s selector strategy.

## `src/` — the architecture

Engine with ops, guard, verify, transport, runner with per-step persistence, side
panel with five views, `src/suite/client.js`, `src/suite/bundle.js`,
`src/suite/validate.js`. Sound, and knows nothing about MCA beyond `.example` stubs.

## The gap in one line

`extension/` knows the portal. `src/` knows how to run a fill safely and talk to
Suite. Nothing connects them, and nothing connects either to VCFO Suite.
