# GST REG-01 profile contract (`form: gst-reg-01`)

> Owned by VCFO Suite. The typed copy is `vcfo-suite/src/lib/registrations/gst-profile.ts`
> (`GST_SOURCE_FIELDS`); when this file and that one disagree, the `.ts` file wins and this
> file is corrected. A field map may only reference a `sourceField` listed here. A key the
> extension needs and does not find goes under **Requested additions** at the end; Suite adopts
> it (or answers why not) and moves it into the tables.

Firm policy SBC-STD-AI-02 applies: **Agents prepare. Humans file.** The person signs in to the
GST portal, types the OTPs and the captcha, does the Aadhaar authentication, signs with DSC or
EVC and presses Submit. The extension never does any of those, never reads or stores an OTP,
an EVC or a portal password, and never sends the full Aadhaar number anywhere. The GST pack is
`legalStatus: mock-only` until the CS opinion (see `src/lib/assist-agents/packs/gst.json`):
until then the extension fills the mock portal only, and on the live portal the person types
from the side panel's prepared values.

## Fetch

```
GET {suiteOrigin}/api/engagements/{id}/assist-profile?form=gst-reg-01
credentials: include   (run inside a Suite tab, as for SPICe+)
```

Staff only (`admin`, `manager`, `intern` on the engagement, `super_admin`); a client or an
engagement out of reach answers 403/404. `Cache-Control: no-store`.

```jsonc
{
  "ok": true,
  "schemaVersion": 1,
  "form": "gst-reg-01",
  "engagement": { "id": "…", "slug": "…", "companyName": "…" },
  "companyName": "…",
  "issuedAt": "ISO-8601",
  "profile": { /* GstProfile, nested, see below */ },
  "fields": { "partA.pan": "AAACX1234X", "promoters.1.firstName": "…" },  // flat sourceField -> value
  "documents": [ /* GstDocument[] */ ],
  "missing": [ { "key": "principalPlace.latitude", "label": "…", "kind": "value|document", "source": "tool|sharepoint|client|portal", "where": "…", "stepId": "reg-4", "tabId": "…", "reason": "…" } ],
  "notes": [ { "key": "…", "note": "…" } ],
  "readiness": { "ready": false, "missingValues": 3, "missingDocuments": 2 }
}
```

`fields` is the flat form of `profile`: every leaf as `section.key`, and repeat rows as
`section.N.key` with N 1-based (`promoters.2.pan`, `additionalPlaces.1.address.pincode`,
`goods.3.hsn`). A multi-value leaf (`principalPlace.activities`, `aadhaar.persons`) is one string
joined with `; ` in `fields` and an array in `profile`. The extension's field maps read `fields`;
`profile` is for display. `isGstSourceField(key)` in `gst-profile.ts` is the check.

### Formats

- Dates `DD/MM/YYYY`. Booleans are real booleans. Numbers are numbers.
- Dropdown values are the GST portal's own label text (the vocabulary tables in
  `gst-profile.ts`). A Suite value with no portal equivalent is `missing` with the reason
  "no GST portal equivalent mapped", never passed through raw.
- **Omission, not invention.** A value Suite does not hold is left out of `profile` and
  `fields` and listed in `missing`. Never a placeholder.

## Part A (New Registration, first screen)

| sourceField | Portal field | Suite source |
|---|---|---|
| `partA.applicantType` | I am a | constant `Taxpayer` (structural default) |
| `partA.state` | State / UT | registered office state (pre-14 / pre-6) |
| `partA.district` | District | reg-4 client field `district` (the checklist holds the office as one line) |
| `partA.legalName` | Legal name of the business (as per PAN) | company name (pre-12, else approved name pre-5) |
| `partA.pan` | PAN | company PAN (pre-12 `pan`) |
| `partA.email` | Email address (OTP goes here) | primary authorised signatory's email |
| `partA.mobile` | Mobile number (OTP goes here) | primary authorised signatory's mobile, 10 digits |

## Part B — Business details

| sourceField | Portal field | Suite source |
|---|---|---|
| `business.tradeName` | Trade name | reg-4 client field `trade-name`, else the company name |
| `business.constitution` | Constitution of business | company type (pre-1) → `GST_CONSTITUTION` |
| `business.jurisdiction.type` | State / Centre jurisdiction | `state` (structural default; Centre fields below) |
| `business.jurisdiction.stateDistrict` | District (state jurisdiction) | reg-4 sbc `jurisdiction` parts, else office district |
| `business.jurisdiction.sector` | Sector / Circle / Ward / Charge / Unit | reg-4 sbc `jurisdiction-sector` |
| `business.jurisdiction.circle` | Circle | reg-4 sbc `jurisdiction-circle` |
| `business.jurisdiction.ward` | Ward | reg-4 sbc `jurisdiction-ward` |
| `business.jurisdiction.commissionerate` | Centre: Commissionerate | reg-4 sbc `centre-commissionerate` |
| `business.jurisdiction.division` | Centre: Division | reg-4 sbc `centre-division` |
| `business.jurisdiction.range` | Centre: Range | reg-4 sbc `centre-range` |
| `business.compositionOpted` | Option for composition | reg-4 client `composition` (yes/no), default `false` |
| `business.casualTaxable` | Casual taxable person | default `false` (a company at incorporation) |
| `business.commencementDate` | Date of commencement of business | reg-4 client `commencement-date`, else incorporation date |
| `business.liabilityDate` | Date on which liability to register arises | reg-4 client `liability-date` (optional) |
| `business.reason` | Reason to obtain registration | reg-4 client `reason` → `GST_REASON` |
| `business.reasonOther` | (when reason is Others) | reg-4 client `reason-other` |
| `business.cin` | (existing registration row) | pre-12 `cin` |
| `business.incorporationDate` | (existing registration row date) | pre-12 `dateOfIncorporation` |

### Existing registrations (repeat `existingRegistrations.N`)

| key | Portal | Source |
|---|---|---|
| `type` | Type of registration | `GST_EXISTING_REGISTRATION` label (`Corporate Identity Number/Foreign Company Registration Number`, `Importer/Exporter Code Number`, …) |
| `number` | Registration No. | CIN (pre-12), IEC (reg-8), Udyam (reg-15), … |
| `date` | Date of registration | the matching date |

## Promoters / partners (repeat `promoters.N`, the directors)

| key | Portal | Source |
|---|---|---|
| `firstName`, `middleName`, `lastName` | Name of person | directors (pre-15 / pre-1) |
| `fatherFirstName`, `fatherMiddleName`, `fatherLastName` | Name of father | directors `fatherName`, split |
| `dob` | Date of birth | directors `dob` |
| `mobile` | Mobile number | directors `mobileNumber`, 10 digits |
| `email` | Email address | directors `personalMailId` |
| `gender` | Gender | `GST_GENDER` (`Male`, `Female`, `Others`) |
| `telephone` | Telephone (optional) | not held; omitted |
| `designation` | Designation / status | directors designation, else `Director` |
| `din` | Director identification number | directors `din` |
| `citizenOfIndia` | Are you a citizen of India? | directors nationality / citizenship |
| `pan` | Permanent account number | directors `panNumber` |
| `passport` | Passport number (non-citizen) | directors `passportNumber` |
| `aadhaarLast4` | **Display only.** The person types the full Aadhaar number on the portal; Suite sends only the last four digits so the panel can say whose card it is. | directors `aadhaarNumber`, masked |
| `aadhaarOnFile` | true when Suite holds the person's Aadhaar | |
| `address.building`, `address.floor`, `address.premises`, `address.road`, `address.locality`, `address.city`, `address.district`, `address.state`, `address.pincode`, `address.country` | Residential address | directors `utilityBillAddress` (split by best effort; `address.full` always sent) |
| `address.full` | (display) | the whole address as stored |
| `photo` | Upload photograph (JPEG, ≤100 KB) | document key `promoter.N.photo` |
| `isPrimarySignatory` | Also authorised signatory | true for the authorised signatory |

## Authorised signatory (`signatory`)

| key | Portal | Source |
|---|---|---|
| `promoterIndex` | "Primary authorised signatory" tick on the promoter, or the same person's details | reg-4 sbc `signatory-index`, else 1 (first director) |
| every promoter key above | Authorised signatory details | copied from that promoter |
| `proofOfAppointment` | Proof of details of authorised signatory | document key `signatory.proof` (board resolution / letter of authorisation) |

## Principal place of business (`principalPlace`)

| key | Portal | Source |
|---|---|---|
| `address.building`, `address.floor`, `address.premises`, `address.road`, `address.locality`, `address.city`, `address.district`, `address.state`, `address.pincode`, `address.full` | Address | reg-4 client `place`, else the registered office (pre-14) |
| `latitude`, `longitude` | Geocode (optional on the portal) | reg-4 client `latitude` / `longitude`, else the registered office |
| `email`, `officePhone`, `mobile` | Contact information | reg-4 client fields, else the signatory's |
| `possession` | Nature of possession of premises | reg-4 client `possession` → `GST_POSSESSION` (`Own`, `Leased`, `Rented`, `Consent`, `Shared`, `Others`) |
| `proofDocType` | Document proof | `GST_PROOF_OF_PLACE` (`Electricity Bill`, `Rent / Lease Agreement`, `Consent Letter`, `Legal Ownership Document`, `Municipal Khata Copy`, `Property Tax Receipt`) |
| `proofDocument` | Upload | document key `place.proof` (rent deed, electricity bill) |
| `nocDocument` | (consent letter / NOC from owner, when Rented/Consent) | document key `place.noc` |
| `activities` | Nature of business activity (multi) | reg-4 client `activities` → `GST_ACTIVITY` (`Office / Sale Office`, `Supplier of Services`, `Retail Business`, `Wholesale Business`, `Factory / Manufacturing`, `Warehouse / Depot`, `Export`, `Import`, `Recipient of Goods or Services`, `Bonded Warehouse`, `EOU / STP / EHTP`, `Leasing Business`, `Service Provision`, `Works Contract`, `Others`) |
| `hasAdditionalPlaces` | Have additional place of business | true when `additionalPlaces` is non-empty |

### Additional places (repeat `additionalPlaces.N`)

Same keys as `principalPlace` (no `hasAdditionalPlaces`); documents `place.N.proof`.

## Goods and services (top five each)

| key | Portal | Source |
|---|---|---|
| `goods.N.hsn`, `goods.N.description` | HSN code (goods) | reg-4 client `hsn` (comma or line separated `code - description`) |
| `services.N.sac`, `services.N.description` | SAC code (services) | reg-4 client `sac`, else the main NIC code mapped to SAC when one is mapped |

At most five rows each; a sixth is dropped with a note.

## Bank account (`bank`, optional at registration)

| key | Portal | Source |
|---|---|---|
| `accountNumber` | Account number | reg-4 client `bank-account` |
| `ifsc` | IFSC | reg-4 client `bank-ifsc` |
| `accountType` | Type of account | `GST_BANK_ACCOUNT_TYPE` (`Current Account`, `Savings`, `Cash Credit`, `Overdraft`, `Others`) |
| `proofDocument` | Bank statement / passbook / cancelled cheque | document key `bank.proof` |

The bank account is optional at REG-01 and is added by a non-core amendment after the GSTIN; a
missing bank row never blocks readiness.

## State-specific information (`stateSpecific`)

| key | Portal | Source |
|---|---|---|
| `professionalTaxEc` | Professional tax employee code (EC) | reg-7 sbc `number` or reg-4 client `pt-ec` |
| `professionalTaxRc` | Professional tax registration certificate (RC) | reg-4 client `pt-rc` |
| `stateExciseLicence` | State excise licence number | reg-4 client `excise-licence` |
| `stateExciseLicenceHolder` | Name of the person in whose name excise licence is held | reg-4 client `excise-holder` |

## Aadhaar authentication (`aadhaar`)

| key | Portal | Source |
|---|---|---|
| `optIn` | Opt for Aadhaar authentication | reg-4 client `aadhaar-opt-in` (yes/no), default `true` (firm practice; avoids physical verification) |
| `persons` | Whose Aadhaar is authenticated | promoter indexes, the signatory first |

The authentication itself (OTP to the Aadhaar-linked mobile) is the person's step. Suite never
sends an Aadhaar number to the extension.

## Verification (`verification`)

| key | Portal | Source |
|---|---|---|
| `signatoryName` | Name of authorised signatory | the signatory's full name |
| `place` | Place | principal place city |

Submit with DSC / EVC / E-Signature is the person's.

## Documents (`documents[]`)

```ts
interface GstDocument {
  key: string;          // 'promoter.1.photo', 'signatory.proof', 'place.proof', 'place.noc', 'bank.proof', 'company.pan', 'company.coi', 'place.2.proof'
  label: string;        // 'Photograph of Priya Rao'
  fileName: string;
  contentType: string;  // 'image/jpeg', 'application/pdf'
  sizeBytes: number | null;
  url: string;          // signed S3 GET URL, short-lived
  expiresAt: string;    // ISO; refetch the profile after this
  source: 'checklist' | 'request' | 'vault';
  portalLimitKb: number; // 100 for photos, 1024 for PDFs (the portal's own caps); the extension warns, never resizes
}
```

Document keys: `company.pan`, `company.coi`, `promoter.N.photo`, `promoter.N.pan`,
`signatory.proof`, `place.proof`, `place.noc`, `place.N.proof`, `bank.proof`.

## Result post-back

```
POST {suiteOrigin}/api/assist/engagements/{id}/result
{ "form": "gst-reg-01", "arn": "AA3611260012345", "arnDate": "25/11/2026", "status": "submitted",
  "capturedAt": "ISO-8601", "fieldsWritten": 61, "mismatches": [] }
```

Later stages post again with the same form: `{ "form": "gst-reg-01", "srn": "…" }`,
`{ "form": "gst-reg-01", "gstin": "36AAACX1234X1Z5", "registeredOn": "DD/MM/YYYY" }`, or
`{ "form": "gst-reg-01", "aadhaar": "done" }`. Suite writes each into the reg-4 tracker
(`compliance_subject_fields`, side `sbc`: `arn`, `arn-date`, `filed-on`, `srn`, `number`,
`registered-on`, `outcome`, `aadhaar`) and an audit event. Idempotent: a repeated post with the
same values changes nothing. Only the project lead records the tracker (owner rule, 12 Nov 2026):
a post from a manager or admin answers 403 `tracker_lead_only`. Formats checked: ARN is `AA`,
the two-digit state code and eleven letters or digits (15 characters); GSTIN is the 15-character
pattern, and its characters 3 to 12 must be the company PAN (422 `gstin_pan_mismatch`). A second,
different ARN answers 409 `arn_already_recorded`. `arnDate` sets the ARN date; without it the
day of the post is used, and only when the tracker has no ARN date yet. The filing day the lead
already recorded is never overwritten. The route answers 503 `assist_not_set_up` while
`VCFO_ASSIST_ENABLED` is off, like the MCA ingest. Response: `{ ok, form, changed: string[], tracker }`.

## Starting from Suite

The reg-4 step page, the GST registration record (`/app/{role}/registrations/{engagement}~reg-4`)
and Ask VCFO show **Start on GST portal**. It keeps the Suite tab where it is, adds
`?assist=gst-reg-01&engagement={engagementId}` to that tab's URL (history.replaceState, no
navigation), sets `document.documentElement.dataset.vcfoAssistForm = 'gst-reg-01'` and
`dataset.vcfoAssistEngagement = '{engagementId}'`, posts
`window.postMessage({ source: 'vcfo-suite', type: 'vcfo-assist:start', form: 'gst-reg-01', engagementId }, location.origin)`,
and opens `https://reg.gst.gov.in/registration/` in a new tab. The extension preselects the
form and the engagement from those URL parameters (or the data attributes) the same way it
already preselects the engagement from a `/projects/{id}` URL; the registration record's URL is
not a projects URL, so the `engagement` parameter is the one to read there.

Suite treats the extension as installed when the page carries
`document.documentElement.dataset.vcfoAssist` (any value, ideally the version). Without it, Suite
shows the install steps (Chrome → Extensions → Developer mode → Load unpacked
`extensions/vcfo-assist/.output/chrome-mv3`, or the firm's managed install).

## Requested additions

Keys the extension needs that are not above. Append rows; Suite adopts them into the tables.

| Requested key | Portal field | Why | Suite answer |
|---|---|---|---|
| | | | |
