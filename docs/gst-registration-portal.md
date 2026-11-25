# GST REG-01 on the portal: page map for VCFO Assist

This is the map of the GST new registration (Form GST REG-01, normal taxpayer) as VCFO Assist
sees it. It was built on 2026-11-25 from three sources, and every selector below says which
one it came from:

| Mark | Source | Trust |
|---|---|---|
| **live** | Seen rendered on `https://reg.gst.gov.in/registration/` (Part A and the TRN login only). Read-only capture: nothing was typed, no button was pressed, no OTP was sent and no TRN was created. | High |
| **tpl** | The portal's own public AngularJS templates (`/pages/registration/newrg/*.html`), the router (`regrouter1.7.js`), the controller (`newregappctrl1.6.js`), the directives and the public option lists (`/master/*`, `/pages/registration/data/*.json`). Part B sits behind TRN login, so these were never seen rendered. | Medium: verify on the first real run |
| **manual** | The official user manual and FAQs (tutorial.gst.gov.in) and CBIC Circular 257/03/2026-GST. | Low for selectors; good for rules |

The raw captures sit in `capture/gst/` (git-ignored: they are the portal's own files). The
field maps in `fieldmaps/gst-reg-01-*.json` are generated from `tools/build-gst-fieldmaps.mjs`,
which carries the same source mark per field. Firm policy SBC-STD-AI-02 applies throughout:
**agents prepare, humans file** (see `docs/06-human-boundary.md`).

## The app

- AngularJS 1.x single-page app, `html5Mode`, `<base href="/registration/">`. Each tab is a
  route under `/registration/auth/newappl/…`. Values live in `ng-model`s, so the engine types
  and raises `input` / `change` as for MCA's jQuery forms (framework `angular` in the maps).
- Option lists load from `/master/*` after the page opens (districts after the state,
  jurisdiction after the PIN code). Fields that depend on them use `waitForOptions`.
- Every **Save & Continue** is a `type="submit"` button. The guard refuses every submit button,
  so each tab ends with a human gate: the person reviews and presses it.
- Uploads use the `data-file-model` / `data-upload-model` directives: an inner
  `<input type="file">` that uploads as soon as it changes, after the document type is chosen
  in the select beside it. The portal can show a legibility pop-up (Retry / Continue) after
  an upload; that pop-up is the person's.

## Where the person acts (never VCFO Assist)

| Where | What | Why |
|---|---|---|
| Part A | Captcha, **PROCEED** | PROCEED sends both OTPs and creates the TRN |
| `/registration/verify` | Mobile OTP, email OTP, PROCEED | OTPs are credentials |
| TRN login | TRN, captcha, PROCEED, OTP, then My Saved Applications → Edit | Login |
| Every Part B tab | **Save & Continue**, **ADD NEW**, the existing-registration **Add** | Saving is the person's act; the guard refuses submit buttons |
| Authorised Representative | Whole tab | Not in the Suite profile |
| Bank Accounts | Whole tab (optional at REG-01) | No template captured; Suite keys exist (`bank.*`) |
| Aadhaar Authentication | Yes / No and the people ticked | Personal choice; Aadhaar number `#uid` is never filled |
| Verification | Declaration tick `#authveri`; **SUBMIT WITH DSC / E-SIGNATURE / EVC**; the EVC OTP or DSC signing | The signatory's legal act |
| After submit | Aadhaar authentication link (OTP to the Aadhaar mobile) or biometric at a GSK within 15 days | The person's identity |

## Part A — New Registration (`/registration/`) — live

| Field | Selector | Notes |
|---|---|---|
| New Registration / TRN | `#radionew` / `#radiotrn`, `name=typ`, values `N` / `T` | New is chosen on load |
| I am a | `#applnType` (`plogin.applnType`) | `APLRG` Taxpayer, `APLTD` Tax Deductor, `APLTC` Tax Collector (e-Commerce), `RTTR1` GST Practitioner, `APLNR` Non Resident Taxable Person, `APLUN`, `APLEM`, `APLOT`, `REGOI` |
| State / UT | `#applnState` (`plogin.stCd`) | 37 entries, value is the state code (`36` Telangana, `97` Other Territory) |
| District | `#applnDistr` (`plogin.dtCd`) | Loads after the state (`/master/st/{code}/activedistrict`); values like `TGHYD` |
| Legal name (as in PAN) | `#bnm`, `name=lgnmbzpan`, maxlength 99 | Checked against the CBDT PAN record |
| PAN | `#pan_card`, maxlength 10 | Business PAN |
| Email | `#email`, maxlength 254 | OTP goes here |
| Mobile | `#mobile`, maxlength 10 | OTP goes here (Indian number, no +91) |
| Captcha | `#captcha` maxlength 6, `img#imgCaptcha` (`/services/captcha`) | Person only |
| PROCEED | `button[type=submit]` | Person only |

**Verified live on 2026-11-25 (Part A fill run).** The extension's Part A recipe filled all seven
fields above, from I am a to Mobile, on the real page with dummy data, and each read back:
type `APLRG`, state `36`, district `TGHYD` (Hyderabad), legal name, PAN, email and mobile.
Angular marked every field `ng-valid ng-dirty ng-touched` and the page showed no validation
message. The form was ready about 5.5 s after the tab opened, `/master/states` loaded before the
fill, and `/master/st/36/activedistrict` loaded about 10 s after the states list, inside the
district wait. The run halted at the recipe's halt step with the captcha empty and PROCEED not
pressed; the page saw no click from the extension, the guard refuses the PROCEED button, and no
non-GET request to any `gst.gov.in` host was made (every one was set to abort). The legal status
stays `mock-only`: the run used a scratchpad copy with that one value lifted.

Then `/registration/verify` (`otpverify.html`): `#mobile_otp`, `#email-otp` (password inputs).
The TRN is shown on the next page and sent by SMS and email; it is valid 15 days.

**TRN login** (same page, `#radiotrn`) — live: `#trnno` (maxlength 15, `plogin.trn`),
`#captchatrn`, PROCEED, then one OTP. Then My Saved Applications → Edit opens Part B.

## Part B — tabs (`/registration/auth/newappl/…`) — tpl unless marked

### Business Details (`business`, `businessdetails.html`)

| Field | Selector | Notes |
|---|---|---|
| Trade name | `#tnm` (`bd.bzdtlsbz.trdnm`), 99 | |
| Constitution of business | `#bd_ConstBuss` (`cobz`) | `/master/cstnbus/aplrg`: Proprietorship, Partnership, Hindu Undivided Family, Private Limited Company, Public Limited Company, Limited Liability Partnership, One Person Company, Others, … May arrive locked from the PAN |
| District | `#dst` | Usually preset from Part A |
| Casual taxable person | `#casual` | Opens validity dates and advance tax (not mapped) |
| Composition | `#composition` | Opens the composition declarations (not mapped) |
| Reason to obtain registration | `#bd_rsl` (`rslibrg`) | `reason_business.json`: Crossing the Threshold, Inter-State supply, Voluntary Basis, Others (Not covered above), … |
| Others (specify) | `#bd_othr`, 50 | When the reason is Others |
| Date of commencement | `#bd_cmbz` | DD/MM/YYYY datepicker |
| Date liability arises | `#lib` | DD/MM/YYYY |
| Existing registrations | `#exty` (type, `existing_reg.json`), `#exno`, `#exdt`, button `name=addexist` **Add** | Repeat: one row per Add (person presses Add) |
| Proof of constitution | `#bd_up_type` (`/master/doclist/bd/active`: Partnership Deed, Registration Certificate, Memorandum of Association and Articles of Association, Certificate of Incorporation, …) + `data-file-model#bd_upload` (max 3 files) | PDF or JPEG, 1 MB |

### Promoter / Partners (`promoters`, `partners.html`) — repeat per person

`#fnm`, `#pd_mname`, `#pd_lname`; father `#ffname`, `#pd_fmname`, `#pd_flname`; `#dob`;
`#mbno`; `#pd_email`; gender radios `#radiomale` / `#radiofemale` / `#radiotrans` (Male,
Female, Others); `#telstd` / `#tlphno`; designation `#dg` (25); DIN `#din` (8, required for
company directors and LLP partners, checked against MCA); citizen `#pd_cit_ind`; PAN `#pan`;
passport `#ppno` (non-citizens); Aadhaar `#uid` (**never filled**); address `#pd_cntry`,
`#pncd`, `#pd_state`, `#dst`, `#city`, `#pd_locality`, `#pd_road`, `#pd_bdname`, `#pd_bdnum`,
`#pd_flrnum`, `#pd_landmark`; photo `data-file-model#pd_upload` (type PHOT, **JPEG, 100 KB**);
`#pri_auth` "Also Authorized Signatory". **ADD NEW** for the next person. The manual's
limits: a company lists every director; there is a records cap shown on the tab.

### Authorized Signatory (`authsignatory`, `authsignatory.html`)

`#auth_prim` primary; the person block with `as_` ids (`#as_mname`, `#as_lname`,
`#as_fmname`, `#as_flname`, `#em`, `#tlpnstd`, `#as_cit_ind`, `#cnty`, `#as_state`, `#st`,
`#bno`, `#as_bdname`, `#as_flrnum`, `#as_landmark`, `#as_locality`); proof
`#as_up_type` (`/master/doclist/as/active`: Letter of Authorisation, Copy of resolution passed
by BoD / Managing Committee) + `#as_upload_sign` (max 2, PDF/JPEG 1 MB).

### Authorized Representative (`authrepresentative`) — person only

`#as_cit_ind` (has a representative), radios `#trp` (GST Practitioner, enrolment `#ar_eid`)
/ `#othrs`, then `#ar_fname` …, `#ar_des`, `#ar_mbno`, `#ar_em`, `#pan`. Not mapped.

### Principal Place of Business (`business/place`, `businessplaces.html`)

| Field | Selector | Notes |
|---|---|---|
| Address | `#pncd`, `#dst`, `#loc`, `#ppbzdtls_locality`, `#st`, `#bp_bdname`, `#bno`, `#bp_flrnum`, `#ppbzdtls_landmark` | PIN look-up fills state and district |
| Geocode | `#bp_latitude`, `#bp_longitude` | Optional; a map pin on the live portal |
| State jurisdiction | `#stj` | Loads after the PIN |
| Centre jurisdiction | `#comcd` → `#divcd` → `#rgcd` | Each loads after the one before |
| Contact | `#bp_email`, `#tlphnoStd` / `#tlphno`, `#bp_mobile`, `#fxnostd` / `#fxno` | |
| Nature of possession | custom drop-down `#bp_buss_poss_btn` + `ul.natpos-dropdown-menu a.natpos-item` (not a `<select>`), sub-category `#bp_psnt_subcat` | Live master (CR-32418-A): Owned, Rented/Leased, Consent Based, Co-working Space, In the name of deceased ancestor, Special Economic Zone, E-commerce Operator's Warehouse under Rule 14B |
| Document proof | `#bp_up_type` (`/master/doclist/bp/active`) + `data-upload-model#bp_upload` | Electricity Bill 500 KB, Rent / Lease agreement 2 MB, Consent Letter 500 KB, Legal ownership document 1 MB, Property Tax Receipt, Municipal Khata Copy, Rent receipt with NOC, … PDF/JPEG |
| Activities | checkboxes `.natbus-table li input#bp_ck_{code}`, `name=bp_bactivity` | Labels from `/master/natbus` (Office / Sale Office, Supplier of Services, Retail Business, …). Ticked by label |
| Additional places | `#bp_add` | Opens the next tab |

### Additional Places of Business (`business/addlplace`) — repeat

`#abp_ctr` count; `#pncd`, `#dst`, `#loc`, `#ap_locality`, `#st`, `#ap_bdname`, `#abp_bdnum`,
`#ap_flrnum`, `#ap_landmark`, `#lat`, `#lng`, `#ap_email`, `#mbno`; possession (hidden `#psnt`;
the drop-down is assumed to match the principal place: **fragile**); `#ap_up_type` +
`#ap_upload`; activities `name=ntbz` (container class assumed). Manual: up to 9999 places
(the FAQ says 500).

### Goods and Services (`goodsservices`, `goodservices.html`)

Autocomplete directives `#gs_hsn` (remote `/master/hsn/l1/`) and `#gs_ssn` (remote
`/master/sac/`). Type at least two characters, pick a row; the row is added to a table and
the box clears. Top five goods and five services. The inner input id `gs_hsn_value` /
`gs_ssn_value`, the row class `angucomplete-row` and the added-rows tables `#hsn_added` /
`#sac_added` are **assumed** (angucomplete-alt's usual naming; the template gives the tables
no id): **verify on the first real run**.

### Bank Accounts (`bankaccounts`) — manual, person only

Optional at REG-01 (the tab came back in November 2026). Count (max 10), account number, type
(Current Account, Savings, Overdraft, Cash Credit, Others), IFSC, proof (`/master/doclist/bk`,
BKOF 1 MB). No template was captured, so it is not mapped.

### State Specific Information (`statespecific`, `stateinfo.html`)

`#ec_tax` (professional tax EC), `#rc_tax` (RC), `#lic_no` (state excise licence),
`#per_lic_no` (holder), `#noelt_con`, `#ebcd`, `#canum` (state-specific extras, not mapped).

### Aadhaar Authentication (`aadhar`, `aadhaar.html`) — person only

`#auth` opt-in (default Yes); per-person ticks `#chkboxpauth`, `chkboxop{i}`. The primary
signatory and at least one promoter must be ticked. After submission the portal sends an
authentication link; without it the application goes to physical verification.

### Verification (`verify`, `verify.html`)

Declaration `#authveri` (**person only**), signatory `#authsign` (select of the signatories
entered), place `#veriPlace` (50). Buttons SUBMIT WITH DSC / SUBMIT WITH E-SIGNATURE / SUBMIT
WITH EVC (**person only**; EVC and E-Sign send an OTP).

### Acknowledgement (`acknowledgement`, `acknowledge.html`) — tpl

"SUCCESS / Thank you for submission. / System is verifying / validating the information
submitted by you. Acknowledgment (ARN) will be made available at your registered email and
mobile No. shortly." The ARN itself is on Track Application Status, in the email and SMS, and
in the message "The form has been submitted successfully and ARN generated is …"
(`SUCCESS_MSG_ARN_GENERATED`). The result recipe reads the page text with the pattern
`AA` + 2-digit state + 4 or 6 digits + 7 alphanumerics (15 or 17 characters); `ERR_ARN` in the
portal's own strings says "15 digit ARN". **Verify on the first real run which page shows
it.**

## How VCFO Assist runs it

1. Suite shows **Start on GST portal**; the Suite page hook (`src/content/suite-hook.js`)
   marks the page `data-vcfo-assist` and relays `vcfo-assist:start`, which preselects
   *GST REG-01 Part A* in the panel. Nothing runs from a page message.
2. The person presses Start in the panel. The worker fetches
   `/api/engagements/{id}/assist-profile?form=gst-reg-01` inside the Suite tab, prepares the
   form and opens `https://reg.gst.gov.in/registration/`.
3. **Part A** (`recipes/gst-reg-01-part-a.json`): fills type, state, district, legal name,
   PAN, email, mobile; halts before the captcha.
4. The person: captcha, PROCEED, OTPs, TRN; later TRN login and Edit.
5. **Part B** (`recipes/gst-reg-01-part-b.json`): one fill per tab, then a human gate. Repeat
   groups (`forEach`) expand per payload row: existing registrations, promoters, additional
   places, HSN rows, SAC rows. Documents come from Suite by key (the attachments route, asked
   inside the Suite tab; a signed S3 URL is not fetched, as no egress but Suite is allowed) and are put into the file input with
   its change event; size and type are checked against the portal caps first.
6. The run halts at Verification. The signatory ticks the declaration and submits.
7. **Read result** in the panel reads the ARN (`recipes/gst-reg-01-part-b.result.json`) and
   posts `{ form: 'gst-reg-01', arn, arnDate, srn, subjectKind: 'registration', subjectKey:
   'reg-4', mismatches }` to `/api/assist/engagements/{id}/result`.

Both recipes are `legalStatus: "mock-only"` (docs/gst-profile-contract.md): the runner refuses
them on a non-loopback origin until the CS opinion is in. Development retargeting to the mock
(`src/engine/devtarget.js`) needs an unpacked build, development mode and a loopback
`va.pref.mockOrigin`.

## First real run: what to verify

1. Part B selectors (all **tpl**): open each tab and confirm the ids above exist and are the
   ones Angular binds (`ng-model`). Especially `#gs_hsn_value` / `#gs_ssn_value`, the
   `.angucomplete-row` class, the HSN/SAC added-rows tables, the additional-place possession
   drop-down and its activity container.
2. Whether typed values stick in Angular datepickers (`#bd_cmbz`, `#lib`, `#dob`).
3. Whether the PIN look-up overwrites state, district and city (the read-back shows it).
4. The upload directive accepts a file set through `DataTransfer` and uploads it; and the
   legibility pop-up's behaviour.
5. Whether `#bd_ConstBuss` is locked from the PAN.
6. Which page shows the ARN, and its length (15 or 17).
7. The Save & Continue tab order (Bank Accounts and Aadhaar positions) after the November 2026
   changes.

Lift `legalStatus` only after the CS opinion, with these verified.
