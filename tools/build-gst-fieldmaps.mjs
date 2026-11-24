// Builds fieldmaps/gst-reg-01-*.json (one map per GST REG-01 page or tab) from
// the compact table below. Run: node tools/build-gst-fieldmaps.mjs [--check]
//
// Sources, per field `src`:
//   live     seen on https://reg.gst.gov.in/registration/ on 2026-11-25 (capture/gst/part-a*.html)
//   tpl      the portal's own public AngularJS template for that tab, fetched 2026-11-25
//            (capture/gst/tpl/*.html). Part B sits behind TRN login, so these were never seen
//            rendered: verify on the first real run.
//   manual   the official user manual only (tutorial.gst.gov.in); verify on the first real run.
// `sourceField` names are Suite's (docs/gst-profile-contract.md). `{n}` marks a repeat row
// (1-based), expanded by engine/expand.js. File fields name a Suite document key.
// Credentials (TRN, captcha, OTP, EVC, the Aadhaar number `#uid`) and the verification
// declaration are deliberately absent: the person does those.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://reg.gst.gov.in';
const VERSION = 1;

/**
 * f(key, label, sourceField, css, opts)
 * opts: type, widget, optional, maxLength, transform, dependsOn, waitForOptions, note, src,
 *       fallbacks, listbox, option, matchPrefix, verifyIn, maxSizeKB, accept, stability
 */
function f(key, label, sourceField, css, o = {}) {
  const type = o.type ?? 'text';
  const widget = o.widget ?? (type === 'select' ? 'native' : type === 'checkbox' ? 'checkbox' : null);
  const src = o.src ?? 'tpl';
  return {
    key,
    label,
    sourceField,
    optional: o.optional ?? sourceField === null,
    type,
    maxLength: o.maxLength ?? null,
    transform: o.transform ?? 'trim',
    entry: {
      mode: widget ? 'widget' : 'typed',
      widgetKind: widget,
      ...(o.listbox ? { listboxSelector: o.listbox } : {}),
      ...(o.option ? { optionSelector: o.option } : {}),
      ...(o.matchPrefix ? { matchPrefix: true } : {}),
    },
    selectors: {
      primary: css,
      fallbacks: o.fallbacks ?? [],
      shadowPath: [],
      stability: o.stability ?? (src === 'live' ? 'stable' : 'likely'),
    },
    dependsOn: o.dependsOn ?? [],
    loadingSelector: null,
    waitForOptions: o.waitForOptions ?? false,
    note: o.note ?? (src === 'live' ? null : `Selector from the portal's ${src === 'tpl' ? 'public template' : 'user manual'}; verify on the first real run.`),
    ...(o.verifyIn ? { verifyIn: o.verifyIn } : {}),
    ...(o.maxSizeKB ? { maxSizeKB: o.maxSizeKB } : {}),
    ...(o.accept ? { accept: o.accept } : {}),
  };
}

const sel = { type: 'select' };
const chk = { type: 'checkbox', transform: '' };
const date = { transform: 'trim|dateDDMMYYYY' };
const PDF_JPG = ['application/pdf', 'image/jpeg'];

/** The address block shared by promoters and the signatory (template ids differ slightly). */
function personAddress(prefix, ids) {
  return [
    f(`${ids.p}country`, 'Residential address: Country', `${prefix}.address.country`, ids.country, { ...sel, optional: true, fallbacks: ids.countryFb }),
    f(`${ids.p}pincode`, 'Residential address: PIN code', `${prefix}.address.pincode`, '#pncd', { maxLength: 6, transform: 'trim|digitsOnly', dependsOn: [`${ids.p}country`] }),
    f(`${ids.p}state`, 'Residential address: State', `${prefix}.address.state`, ids.state, { maxLength: 50, dependsOn: [`${ids.p}pincode`], note: 'The portal looks the PIN code up and may fill this itself; the read-back shows what it kept.' }),
    f(`${ids.p}district`, 'Residential address: District', `${prefix}.address.district`, '#dst', { maxLength: 50, dependsOn: [`${ids.p}pincode`] }),
    f(`${ids.p}city`, 'Residential address: City / Town / Village', `${prefix}.address.city`, '#city', { maxLength: 60, dependsOn: [`${ids.p}pincode`] }),
    f(`${ids.p}locality`, 'Residential address: Locality / Sub-locality', `${prefix}.address.locality`, ids.locality, { optional: true, maxLength: 80, dependsOn: [`${ids.p}pincode`] }),
    f(`${ids.p}road`, 'Residential address: Road / Street', `${prefix}.address.road`, ids.road, { maxLength: 120 }),
    f(`${ids.p}premises`, 'Residential address: Name of the premises / building', `${prefix}.address.premises`, ids.premises, { optional: true, maxLength: 100 }),
    f(`${ids.p}building`, 'Residential address: Building no. / Flat no.', `${prefix}.address.building`, ids.building, { maxLength: 60 }),
    f(`${ids.p}floor`, 'Residential address: Floor no.', `${prefix}.address.floor`, ids.floor, { optional: true, maxLength: 60 }),
  ];
}

/** Person details shared by promoters and the signatory. */
function person(prefix, p, ids) {
  return [
    f(`${p}first-name`, 'First name', `${prefix}.firstName`, '#fnm', { maxLength: 99 }),
    f(`${p}middle-name`, 'Middle name', `${prefix}.middleName`, ids.mname, { optional: true, maxLength: 99 }),
    f(`${p}last-name`, 'Last name', `${prefix}.lastName`, ids.lname, { optional: true, maxLength: 99 }),
    f(`${p}father-first`, "Father's first name", `${prefix}.fatherFirstName`, '#ffname', { maxLength: 99 }),
    f(`${p}father-middle`, "Father's middle name", `${prefix}.fatherMiddleName`, ids.fmname, { optional: true, maxLength: 99 }),
    f(`${p}father-last`, "Father's last name", `${prefix}.fatherLastName`, ids.flname, { optional: true, maxLength: 99 }),
    f(`${p}dob`, 'Date of birth (DD/MM/YYYY)', `${prefix}.dob`, '#dob', { ...date, maxLength: 10, widget: 'datepicker', type: 'date' }),
    f(`${p}mobile`, 'Mobile number', `${prefix}.mobile`, '#mbno', { maxLength: 10, transform: 'trim|digitsOnly' }),
    f(`${p}email`, 'Email address', `${prefix}.email`, ids.email, { type: 'email', maxLength: 254, transform: 'trim|lower' }),
    f(`${p}gender`, 'Gender', `${prefix}.gender`, '#radiomale', { type: 'select', widget: 'radio' }),
    f(`${p}designation`, 'Designation / status', `${prefix}.designation`, '#dg', { maxLength: 25 }),
    f(`${p}din`, 'Director Identification Number (DIN)', `${prefix}.din`, '#din', { optional: true, maxLength: 8, transform: 'trim|digitsOnly', note: 'Required for company directors and LLP designated partners; the portal checks it against MCA.' }),
    f(`${p}citizen`, 'Are you a citizen of India?', `${prefix}.citizenOfIndia`, ids.citizen, chk),
    f(`${p}pan`, 'Permanent Account Number (PAN)', `${prefix}.pan`, '#pan', { maxLength: 10, transform: 'trim|upper', dependsOn: [`${p}citizen`] }),
    f(`${p}passport`, 'Passport number (for a person who is not a citizen)', `${prefix}.passport`, '#ppno', { optional: true, maxLength: 15, transform: 'trim|upper', dependsOn: [`${p}citizen`] }),
  ];
}

const MAPS = {
  'gst-reg-01-part-a': {
    capturedFrom: 'live https://reg.gst.gov.in/registration/ 2026-11-25 (capture/gst/part-a.html, part-a-after-select.html)',
    sections: {
      partA: [
        f('applicant-type', 'I am a', 'partA.applicantType', '#applnType', { ...sel, src: 'live' }),
        f('state', 'State / UT', 'partA.state', '#applnState', { ...sel, src: 'live', dependsOn: ['applicant-type'] }),
        f('district', 'District', 'partA.district', '#applnDistr', { ...sel, src: 'live', dependsOn: ['state'], waitForOptions: true, note: 'Districts load after the state (GET /master/st/{code}/activedistrict).' }),
        f('legal-name', 'Legal Name of the Business (As mentioned in PAN)', 'partA.legalName', '#bnm', { src: 'live', maxLength: 99 }),
        f('pan', 'Permanent Account Number (PAN)', 'partA.pan', '#pan_card', { src: 'live', maxLength: 10, transform: 'trim|upper' }),
        f('email', 'Email Address', 'partA.email', '#email', { src: 'live', note: 'The portal sends an OTP here after PROCEED; the person types it.', type: 'email', maxLength: 254, transform: 'trim|lower' }),
        f('mobile', 'Mobile Number', 'partA.mobile', '#mobile', { src: 'live', note: 'The portal sends an OTP here after PROCEED; the person types it.', maxLength: 10, transform: 'trim|digitsOnly' }),
      ],
    },
  },
  'gst-reg-01-business': {
    capturedFrom: 'template /pages/registration/newrg/businessdetails.html 2026-11-25 (route /registration/auth/newappl/business)',
    sections: {
      business: [
        f('trade-name', 'Trade Name', 'business.tradeName', '#tnm', { optional: true, maxLength: 99 }),
        f('constitution', 'Constitution of Business', 'business.constitution', '#bd_ConstBuss', { ...sel, note: 'Options come from GET /master/cstnbus/aplrg (e.g. "Private Limited Company", "Limited Liability Partnership"). The portal may hold this locked from Part A.' }),
        f('casual', 'Are you applying for registration as a casual taxable person?', 'business.casualTaxable', '#casual', { ...chk, optional: true }),
        f('composition', 'Option for Composition', 'business.compositionOpted', '#composition', { ...chk, optional: true }),
        f('reason', 'Reason to obtain registration', 'business.reason', '#bd_rsl', { ...sel, dependsOn: ['casual', 'composition'], note: 'Options from /pages/registration/data/reason_business.json (e.g. "Voluntary Basis", "Crossing the Threshold").' }),
        f('reason-other', 'Reason: Others (Please specify)', 'business.reasonOther', '#bd_othr', { optional: true, maxLength: 50, dependsOn: ['reason'] }),
        f('commencement-date', 'Date of commencement of business (DD/MM/YYYY)', 'business.commencementDate', '#bd_cmbz', { ...date, maxLength: 10, type: 'date', widget: 'datepicker' }),
        f('liability-date', 'Date on which liability to register arises (DD/MM/YYYY)', 'business.liabilityDate', '#lib', { ...date, optional: true, maxLength: 10, type: 'date', widget: 'datepicker' }),
        f('constitution-proof-type', 'Proof of Constitution of Business: document type', 'business.constitutionProofType', '#bd_up_type', { ...sel, optional: true, note: 'Options from GET /master/doclist/bd/active ("Certificate of Incorporation", "Partnership Deed", …). Requested from Suite (see the contract).' }),
        f('constitution-proof', 'Proof of Constitution of Business: upload (PDF or JPEG, 1 MB)', 'company.coi', '#bd_upload', { type: 'file', optional: true, maxSizeKB: 1024, accept: PDF_JPG, dependsOn: ['constitution-proof-type'], fallbacks: ['[data-id="bd_upload"]'] }),
      ],
      existingReg: [
        f('existing-type', 'Existing registration: type', 'existingRegistrations.{n}.type', '#exty', { ...sel, note: 'Options from /pages/registration/data/existing_reg.json.' }),
        f('existing-number', 'Existing registration: registration no.', 'existingRegistrations.{n}.number', '#exno', { dependsOn: ['existing-type'] }),
        f('existing-date', 'Existing registration: date of registration (DD/MM/YYYY)', 'existingRegistrations.{n}.date', '#exdt', { ...date, maxLength: 10, type: 'date', widget: 'datepicker' }),
      ],
    },
  },
  'gst-reg-01-promoters': {
    capturedFrom: 'template /pages/registration/newrg/partners.html 2026-11-25 (route /registration/auth/newappl/promoters)',
    sections: {
      promoter: [
        ...person('promoters.{n}', 'pr-', { mname: '#pd_mname', lname: '#pd_lname', fmname: '#pd_fmname', flname: '#pd_flname', email: '#pd_email', citizen: '#pd_cit_ind' }),
        ...personAddress('promoters.{n}', {
          p: 'pr-', country: '[name="pd_cntry"]', countryFb: ['#pd_cntry'], state: '#pd_state', locality: '#pd_locality', road: '#pd_road',
          premises: '#pd_bdname', building: '#pd_bdnum', floor: '#pd_flrnum',
        }),
        f('pr-photo', 'Photograph (JPEG, at most 100 KB)', 'promoter.{n}.photo', '#pd_upload', { type: 'file', optional: true, maxSizeKB: 100, accept: ['image/jpeg'], fallbacks: ['[data-id="pd_upload"]'] }),
        f('pr-primary-signatory', 'Also Authorized Signatory', 'promoters.{n}.isPrimarySignatory', '#pri_auth', { ...chk, optional: true }),
      ],
    },
  },
  'gst-reg-01-signatory': {
    capturedFrom: 'template /pages/registration/newrg/authsignatory.html 2026-11-25 (route /registration/auth/newappl/authsignatory)',
    sections: {
      signatory: [
        f('as-primary', 'Primary Authorized Signatory', 'signatory.isPrimarySignatory', '#auth_prim', { ...chk, optional: true }),
        ...person('signatory', 'as-', { mname: '#as_mname', lname: '#as_lname', fmname: '#as_fmname', flname: '#as_flname', email: '#em', citizen: '#as_cit_ind' }),
        ...personAddress('signatory', {
          p: 'as-', country: '#cnty', state: '#as_state', locality: '#as_locality', road: '#st',
          premises: '#as_bdname', building: '#bno', floor: '#as_flrnum',
        }),
        f('as-proof-type', 'Proof of details of authorised signatory: document type', 'signatory.proofDocType', '#as_up_type', { ...sel, optional: true, note: 'Options from GET /master/doclist/as/active ("Letter of Authorisation", "Copy of resolution passed by BoD / Managing Committee").' }),
        f('as-proof', 'Proof of appointment: upload (PDF or JPEG, 1 MB)', 'signatory.proof', '#as_upload_sign', { type: 'file', optional: true, maxSizeKB: 1024, accept: PDF_JPG, dependsOn: ['as-proof-type'], fallbacks: ['[data-id="as_upload_sign"]'] }),
      ],
    },
  },
  'gst-reg-01-principal-place': {
    capturedFrom: 'template /pages/registration/newrg/businessplaces.html 2026-11-25 (route /registration/auth/newappl/business/place)',
    sections: {
      principalPlace: [
        f('pp-pincode', 'PIN code', 'principalPlace.address.pincode', '#pncd', { maxLength: 6, transform: 'trim|digitsOnly' }),
        f('pp-district', 'District', 'principalPlace.address.district', '#dst', { optional: true, maxLength: 50, dependsOn: ['pp-pincode'] }),
        f('pp-city', 'City / Town / Village', 'principalPlace.address.city', '#loc', { maxLength: 60, dependsOn: ['pp-pincode'] }),
        f('pp-locality', 'Locality / Sub-locality', 'principalPlace.address.locality', '#ppbzdtls_locality', { optional: true, maxLength: 80, dependsOn: ['pp-pincode'] }),
        f('pp-road', 'Road / Street', 'principalPlace.address.road', '#st', { maxLength: 120 }),
        f('pp-premises', 'Name of the premises / building', 'principalPlace.address.premises', '#bp_bdname', { optional: true, maxLength: 100 }),
        f('pp-building', 'Building no. / Flat no.', 'principalPlace.address.building', '#bno', { maxLength: 60 }),
        f('pp-floor', 'Floor no.', 'principalPlace.address.floor', '#bp_flrnum', { optional: true, maxLength: 60 }),
        f('pp-latitude', 'Latitude', 'principalPlace.latitude', '#bp_latitude', { optional: true, maxLength: 27 }),
        f('pp-longitude', 'Longitude', 'principalPlace.longitude', '#bp_longitude', { optional: true, maxLength: 27 }),
        f('pp-state-jurisdiction', 'State jurisdiction: Sector / Circle / Ward / Charge / Unit', 'business.jurisdiction.sector', '#stj', { ...sel, optional: true, waitForOptions: true, dependsOn: ['pp-pincode'] }),
        f('pp-commissionerate', 'Centre jurisdiction: Commissionerate', 'business.jurisdiction.commissionerate', '#comcd', { ...sel, optional: true, waitForOptions: true, dependsOn: ['pp-pincode'] }),
        f('pp-division', 'Centre jurisdiction: Division', 'business.jurisdiction.division', '#divcd', { ...sel, optional: true, waitForOptions: true, dependsOn: ['pp-commissionerate'] }),
        f('pp-range', 'Centre jurisdiction: Range', 'business.jurisdiction.range', '#rgcd', { ...sel, optional: true, waitForOptions: true, dependsOn: ['pp-division'] }),
        f('pp-email', 'Office email address', 'principalPlace.email', '#bp_email', { type: 'email', maxLength: 254, transform: 'trim|lower' }),
        f('pp-phone', 'Office telephone number', 'principalPlace.officePhone', '#tlphno', { optional: true, maxLength: 16, transform: 'trim|digitsOnly' }),
        f('pp-mobile', 'Mobile number', 'principalPlace.mobile', '#bp_mobile', { maxLength: 10, transform: 'trim|digitsOnly' }),
        f('pp-possession', 'Nature of possession of premises', 'principalPlace.possession', '#bp_buss_poss_btn', {
          type: 'select', widget: 'listbox', listbox: '.natpos-dropdown-menu', option: 'a.natpos-item',
          note: 'A custom drop-down, not a <select>. Live options (GET /master/natpos/aplrg, active): Owned, Rented/Leased, Consent Based, Co-working Space, In the name of deceased ancestor, Special Economic Zone. Some open a sub-category.',
        }),
        f('pp-proof-type', 'Document proof of the principal place', 'principalPlace.proofDocType', '#bp_up_type', { ...sel, optional: true, dependsOn: ['pp-possession'], note: 'Options from GET /master/doclist/bp/active (e.g. "Electricity Bill", "Rent / Lease agreement").' }),
        f('pp-proof', 'Upload proof of the principal place (PDF or JPEG)', 'place.proof', '#bp_upload', { type: 'file', optional: true, maxSizeKB: 2000, accept: PDF_JPG, dependsOn: ['pp-proof-type'], fallbacks: ['[data-id="bp_upload"]'], note: 'Size cap depends on the document type (500 KB for a bill, 2 MB for a rent agreement); the portal says no if it is too large.' }),
        f('pp-activities', 'Nature of business activity at the premises', 'principalPlace.activities', '.natbus-table', {
          type: 'select', widget: 'checklist', dependsOn: ['pp-possession'],
          note: 'Ticks each box whose label is in the list ("A; B", as Suite flattens it). Live labels: GET /master/natbus.',
        }),
        f('pp-has-additional', 'Have additional place of business', 'principalPlace.hasAdditionalPlaces', '#bp_add', { ...chk, optional: true }),
      ],
    },
  },
  'gst-reg-01-additional-places': {
    capturedFrom: 'template /pages/registration/newrg/addlbusinessplaces.html 2026-11-25 (route /registration/auth/newappl/business/addlplace)',
    sections: {
      additionalCount: [
        f('ap-count', 'Number of additional places', 'meta.additionalPlacesCount', '#abp_ctr', { optional: true, maxLength: 4, transform: 'trim|digitsOnly', note: 'Requested from Suite (see the contract).' }),
      ],
      additionalPlace: [
        f('ap-pincode', 'PIN code', 'additionalPlaces.{n}.address.pincode', '#pncd', { maxLength: 6, transform: 'trim|digitsOnly' }),
        f('ap-district', 'District', 'additionalPlaces.{n}.address.district', '#dst', { optional: true, maxLength: 50, dependsOn: ['ap-pincode'] }),
        f('ap-city', 'City / Town / Village', 'additionalPlaces.{n}.address.city', '#loc', { maxLength: 60, dependsOn: ['ap-pincode'] }),
        f('ap-locality', 'Locality / Sub-locality', 'additionalPlaces.{n}.address.locality', '#ap_locality', { optional: true, maxLength: 80, dependsOn: ['ap-pincode'] }),
        f('ap-road', 'Road / Street', 'additionalPlaces.{n}.address.road', '#st', { maxLength: 60 }),
        f('ap-premises', 'Name of the premises / building', 'additionalPlaces.{n}.address.premises', '#ap_bdname', { optional: true, maxLength: 100 }),
        f('ap-building', 'Building no. / Flat no.', 'additionalPlaces.{n}.address.building', '#abp_bdnum', { maxLength: 60 }),
        f('ap-floor', 'Floor no.', 'additionalPlaces.{n}.address.floor', '#ap_flrnum', { optional: true, maxLength: 60 }),
        f('ap-latitude', 'Latitude', 'additionalPlaces.{n}.latitude', '#lat', { optional: true, maxLength: 27 }),
        f('ap-longitude', 'Longitude', 'additionalPlaces.{n}.longitude', '#lng', { optional: true, maxLength: 27 }),
        f('ap-email', 'Office email address', 'additionalPlaces.{n}.email', '#ap_email', { optional: true, type: 'email', maxLength: 254, transform: 'trim|lower' }),
        f('ap-mobile', 'Mobile number', 'additionalPlaces.{n}.mobile', '#mbno', { maxLength: 10, transform: 'trim|digitsOnly' }),
        f('ap-possession', 'Nature of possession of premises', 'additionalPlaces.{n}.possession', '.natpos-dropdown-toggle', {
          type: 'select', widget: 'listbox', listbox: '.natpos-dropdown-menu', option: 'a.natpos-item', stability: 'fragile',
          note: 'Assumed to be the same custom drop-down as the principal place (only a hidden #psnt is in the template).',
        }),
        f('ap-proof-type', 'Document proof of the place', 'additionalPlaces.{n}.proofDocType', '#ap_up_type', { ...sel, optional: true, dependsOn: ['ap-possession'] }),
        f('ap-activities', 'Nature of business activity at the premises', 'additionalPlaces.{n}.activities', '.natbus-table', {
          type: 'select', widget: 'checklist', optional: true, stability: 'fragile',
          note: 'The template names these checkboxes `ntbz`; the container class is assumed to match the principal place.',
        }),
        f('ap-proof', 'Upload proof of the place (PDF or JPEG)', 'place.{n}.proof', '#ap_upload', { type: 'file', optional: true, maxSizeKB: 2000, accept: PDF_JPG, dependsOn: ['ap-proof-type'], fallbacks: ['[data-id="ap_upload"]'] }),
      ],
    },
  },
  'gst-reg-01-goods-services': {
    capturedFrom: 'template /pages/registration/newrg/goodservices.html 2026-11-25 (route /registration/auth/newappl/goodsservices)',
    sections: {
      goodsRow: [
        f('hsn', 'HSN code (goods)', 'goods.{n}.hsn', '#gs_hsn_value', {
          type: 'select', widget: 'combobox', listbox: '.angucomplete-dropdown', option: '.angucomplete-row', matchPrefix: true,
          verifyIn: '#hsn_added', stability: 'fragile',
          note: 'An autocomplete search (remote /master/hsn/l1/, at least 2 characters) that clears itself and adds a row. The input id `gs_hsn_value` is the autocomplete directive\'s usual naming and the added-rows table has no id in the template: both are from the mock, verify on the first real run.',
        }),
      ],
      serviceRow: [
        f('sac', 'SAC code (services)', 'services.{n}.sac', '#gs_ssn_value', {
          type: 'select', widget: 'combobox', listbox: '.angucomplete-dropdown', option: '.angucomplete-row', matchPrefix: true,
          verifyIn: '#sac_added', stability: 'fragile',
          note: 'As for HSN, with remote /master/sac/. Verify on the first real run.',
        }),
      ],
    },
  },
  'gst-reg-01-state-specific': {
    capturedFrom: 'template /pages/registration/newrg/stateinfo.html 2026-11-25 (route /registration/auth/newappl/statespecific)',
    sections: {
      stateSpecific: [
        f('ss-pt-ec', 'Professional Tax Employee Code (EC) No.', 'stateSpecific.professionalTaxEc', '#ec_tax', { optional: true, maxLength: 20 }),
        f('ss-pt-rc', 'Professional Tax Registration Certificate (RC) No.', 'stateSpecific.professionalTaxRc', '#rc_tax', { optional: true, maxLength: 20 }),
        f('ss-excise-licence', 'State Excise Licence No.', 'stateSpecific.stateExciseLicence', '#lic_no', { optional: true, maxLength: 20 }),
        f('ss-excise-holder', 'Name of the person in whose name the excise licence is held', 'stateSpecific.stateExciseLicenceHolder', '#per_lic_no', { optional: true, maxLength: 99 }),
      ],
    },
  },
  'gst-reg-01-verification': {
    capturedFrom: 'template /pages/registration/newrg/verify.html 2026-11-25 (route /registration/auth/newappl/verify)',
    sections: {
      verification: [
        f('vf-signatory', 'Name of Authorized Signatory', 'verification.signatoryName', '#authsign', { ...sel, note: 'The declaration tick box above it is the signatory\'s own act and is never ticked by VCFO Assist.' }),
        f('vf-place', 'Place', 'verification.place', '#veriPlace', { maxLength: 50 }),
      ],
    },
  },
};

const check = process.argv.includes('--check');
let drift = 0;
for (const [id, spec] of Object.entries(MAPS)) {
  const fields = Object.values(spec.sections).flat();
  const map = {
    id,
    version: VERSION,
    origin: ORIGIN,
    framework: 'angular',
    requiresSchemaVersion: 1,
    capturedFrom: spec.capturedFrom,
    _note: `Generated by tools/build-gst-fieldmaps.mjs; do not edit by hand. ${fields.length} fields. sourceField names are VCFO Suite's (docs/gst-profile-contract.md).`,
    sections: spec.sections,
  };
  const file = path.join(ROOT, 'fieldmaps', `${id}.json`);
  const text = `${JSON.stringify(map, null, 2)}\n`;
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
      drift += 1;
      console.error(`drift: ${path.relative(ROOT, file)} differs from the generator`);
    }
  } else {
    fs.writeFileSync(file, text);
    console.log(`wrote ${path.relative(ROOT, file)} (${fields.length} fields)`);
  }
}
if (drift) process.exit(1);
