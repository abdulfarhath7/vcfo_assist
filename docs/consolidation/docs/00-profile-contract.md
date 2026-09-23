# 02 — The profile contract

The shape Assist expects, and where each part comes from. Taken from
`vcfo_assist/extension/sample/profile.sample.json` and `extension/lib/mapping.js`.

## Top-level sections

| Section | Feeds | Build in phase |
|---|---|---|
| `mcaLogin` | login form | **never populated by Suite** — stays `{ userId: "" }` |
| `company` | SPICe+ Part A and Part B | P1 |
| `registeredOffice` | Part B section 2, AGILE-PRO-S | P1 |
| `subscribers[]` | Part B, INC-33, INC-34 | P1 |
| `directors[]` | Part B director blocks, INC-9 | P1 |
| `agile` | AGILE-PRO-S | P2 |
| `moa` | INC-33 | P2 |
| `aoa` | INC-34 | P2 |

P1 covers what Suite actually holds today. P2 covers the rest, and much of it will
resolve to `missing` rather than a value — that is the correct outcome, not a
failure.

## company

| Profile key | Source |
|---|---|
| `proposedNames[]` | `resolveProposedCompanyName(pre5, pre1, engagement)` for the approved name; the proposed alternatives from pre-1 |
| `type`, `class`, `category`, `subCategory` | pre-1 company structure responses, translated through `vocabulary.ts` |
| `nicCode`, `nicDescription` | pre-1 |
| `hasShareCapital`, `aoaEntrenched` | pre-1; default `true` and `false` when absent |
| `capital.*` | pre-1 capital fields. `equity.classes` defaults to 1, `preference.classes` to 0 |

`nicCode` carries a note in `mapping.js`: the NIC row is picked from a popup table by
hand and `MainNICCode` is read-only. Keep that note in the `missing`/`notes` output so
the lead knows one field is theirs.

## registeredOffice

Everything from `resolveRegisteredOfficeResponses(pre6, pre8, pre14)`. Note the
portal's own behaviour, already encoded in `mapping.js`: typing `pincode` triggers a
server lookup that repopulates area, city, district and state, and `area` is marked
`waitForOptions`. Suite must still supply all of them — Assist decides the order.

`longitude` and `latitude` are on the MCA form. If Suite does not hold them, they are
`missing`, not invented.

## subscribers[] and directors[]

Source: `proposed-directors.ts` → `ProposedDirector[]`, each with `index` and a
`values: Record<string, string>` map using template keys (`firstName`, `gender`,
`dob`, `pan`, …).

`mapping.js`'s `person()` consumes: `firstName`, `middleName`, `surName` (or
`lastName`), `father.firstName|middleName|surName`, `gender`, `dob`, `nationality`,
`placeOfBirth`, `occupationType`, `areaOfOccupation`, `othersOccupation`,
`education`, `othersEducation`, `pan`.

Map `ProposedDirector.values` onto those names. Where Suite's key differs, translate
in `build.ts`, not by renaming anything in Assist.

A subscriber additionally needs `kind`, `isDirector`, `din`, `email`, `mobile`,
`designation`, `category`, `shares.equity.class`, `shares.equity.number`,
`interests[]`.

Preserve `ProposedDirector.index` as the array position, because `mapping.js` uses
`instance` to target repeat-panel rows. A director dropped from the middle of the
list silently shifts every subsequent panel.

## Dates and formats

- Dates: `DD/MM/YYYY`. Suite stores ISO in places. Convert in `build.ts`, once, in a
  named helper.
- Numbers: Assist's `num()` stringifies. Send numbers; do not pre-format.
- Booleans: Assist's `YN()` accepts `true`/`false`/`Y`/`N`/`Yes`/`No`. Send real
  booleans.

## vocabulary.ts

Every value that must match MCA dropdown text **exactly**. One exported table, one
test file. Examples from the sample profile:

```ts
/** MCA's vocabulary, not Suite's. These strings must match the portal's
 *  dropdown text character for character. When MCA changes a label, this is
 *  the only file that changes. */
export const COMPANY_CLASS = { private: 'Private', public: 'Public' } as const;
export const COMPANY_CATEGORY = { limitedByShares: 'Company limited by shares' } as const;
export const COMPANY_SUBCATEGORY = { nonGovernment: 'Non-government company' } as const;
export const COMPANY_TYPE = { newOthers: 'New Company (Others)' } as const;
```

A Suite value with no entry in the table is `missing` with the reason "no MCA
equivalent mapped", never a guess and never passed through raw.

## Result shape

```ts
{
  schemaVersion: 1,
  companyName: string,
  profile: AssistProfile,          // the JSON Assist consumes
  missing: Array<{
    key: string,                   // 'company.nicCode', 'director.2.pan'
    label: string,
    stepId: string,                // 'pre-1'
    tabId: string,                 // section slug, for deep linking
    reason?: string
  }>,
  notes: Array<{ key: string, note: string }>   // e.g. the NIC popup caveat
}
```

`missing` mirrors `doc-pack`'s `RequiredInput` output deliberately. Reuse its `key`
naming so a lead sees the same identifiers in both places.

## Omission, not invention

A field Suite does not hold is omitted from `profile` and listed in `missing`.
`mapping.js` already skips `undefined`, `null` and `''`, so an omitted key simply is
not filled. Never emit a placeholder, and never carry a default that looks like real
data. The only defaults permitted are the structural ones named above
(`country: 'India'`, `equity.classes: 1`, `preference.classes: 0`,
`hasShareCapital: true`, `aoaEntrenched: false`), each with a comment saying why.
