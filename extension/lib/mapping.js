/* vCFO Assist — maps a vCFO client profile to MCA SPICe+ form field keys.
 *
 * Field keys are the semantic CSS class names MCA's AEM Adaptive Forms put on each
 * `.guideFieldNode` (e.g. `type-of-company`, `proposedname1`, `din7a`). They were
 * captured from the live portal (see ../schemas/*.compact.json) and are stable across
 * repeat-panel instances, unlike the numeric widget ids.
 *
 * Output shape per form: [{ key, value, instance?, note? }, ...] in fill order.
 */
(function (root) {
  'use strict';

  const YN = (v) => (v === true || v === 'Y' || v === 'Yes' || v === 'yes' ? 'Yes' : v === false || v === 'N' || v === 'No' || v === 'no' ? 'No' : v);
  const num = (v) => (v === undefined || v === null || v === '' ? undefined : String(v));
  const get = (o, p, d) => p.split('.').reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), o) ?? d;
  const push = (arr, key, value, extra) => { if (value !== undefined && value !== null && value !== '') arr.push(Object.assign({ key, value }, extra || {})); };

  function address(arr, a, keys, inst) {
    if (!a) return;
    const x = (k) => keys[k];
    push(arr, x('line1'), a.line1, inst); push(arr, x('line2'), a.line2, inst);
    push(arr, x('country'), a.country || 'India', inst);
    push(arr, x('pincode'), a.pincode, inst);           // triggers area/city/district/state lookup on the portal
    push(arr, x('area'), a.area, Object.assign({ waitForOptions: true }, inst || {}));
    push(arr, x('city'), a.city, inst); push(arr, x('district'), a.district, inst); push(arr, x('state'), a.state, inst);
    push(arr, x('phone'), a.phone, inst); push(arr, x('fax'), a.fax, inst);
  }

  function person(arr, p, k, inst) {
    push(arr, k.firstName, p.firstName, inst); push(arr, k.middleName, p.middleName, inst); push(arr, k.surName, p.surName || p.lastName, inst);
    push(arr, k.fatherFirstName, get(p, 'father.firstName'), inst); push(arr, k.fatherMiddleName, get(p, 'father.middleName'), inst); push(arr, k.fatherSurName, get(p, 'father.surName'), inst);
    push(arr, k.gender, p.gender, inst); push(arr, k.dob, p.dob, inst); push(arr, k.nationality, p.nationality || 'India', inst);
    push(arr, k.placeOfBirth, p.placeOfBirth, inst);
    push(arr, k.occupationType, p.occupationType, inst); push(arr, k.areaOfOccupation, p.areaOfOccupation, inst); push(arr, k.othersOccupation, p.othersOccupation, inst);
    push(arr, k.education, p.education, inst); push(arr, k.othersEducation, p.othersEducation, inst);
    push(arr, k.pan, p.pan, inst);
  }

  /* ---------------- SPICe+ Part A (name reservation) ---------------- */
  function partA(pf) {
    const c = pf.company || {}; const out = [];
    push(out, 'type-of-company', c.type || 'New Company (Others)');
    push(out, 'class-of-company', c.class, { waitForOptions: true });
    push(out, 'category-of-company', c.category, { waitForOptions: true });
    push(out, 'subcategory-of-company', c.subCategory, { waitForOptions: true });
    push(out, 'nic-text-box', c.nicCode, { note: 'Pick the NIC row from the popup table manually; MainNICCode is read-only.' });
    push(out, 'proposedname1', (c.proposedNames || [])[0]);
    push(out, 'proposedname2', (c.proposedNames || [])[1]);
    return out;
  }

  /* ---------------- SPICe+ Part B (INC-32) ---------------- */
  function partB(pf) {
    const c = pf.company || {}, cap = c.capital || {}, eq = cap.equity || {}, pr = cap.preference || {};
    const ro = pf.registeredOffice || {};
    const subs = pf.subscribers || [], dirs = pf.directors || [];
    const out = [];

    // Section 1 — Structure of the company
    push(out, 'aoaEntrenched', YN(c.aoaEntrenched === undefined ? false : c.aoaEntrenched));
    push(out, 'articlesEntrenchment', num(c.entrenchedArticlesCount));
    push(out, 'havingShareCapitalOrNot', c.hasShareCapital === false ? 'Not Having Share Capital' : 'Having Share Capital');
    push(out, 'totalUnclassifiedAuthorizedShareCa', num(cap.unclassifiedAuthorized ?? 0));
    push(out, 'numberOfClasses', num(eq.classes ?? 1));
    push(out, 'classe1', eq.className || 'Equity');
    push(out, 'numberofeshares_1', num(eq.authorizedShares));
    push(out, 'subeshare_1', num(eq.subscribedShares));
    push(out, 'amountpershare_1', num(eq.faceValue));
    push(out, 'preferenceNumberOfClasses_1', num(pr.classes ?? 0));
    if (pr.classes) {
      push(out, 'classp1', pr.className); push(out, 'preshare_1', num(pr.authorizedShares)); push(out, 'subpreshare_1', num(pr.subscribedShares)); push(out, 'preamountpershare_1', num(pr.faceValue));
    }
    push(out, 'maximumNumberOfMembers', num(c.maxMembers)); push(out, 'numberOfMembers', num(c.members));

    // Section 2 — Address of the company (correspondence / registered office)
    push(out, 'correspondenceaddressline1', ro.line1); push(out, 'correspondenceaddressline2', ro.line2);
    push(out, 'correspondenceaddress_pinCode', ro.pincode);
    push(out, 'Area1', ro.area, { waitForOptions: true });
    push(out, 'stdCode_4A', ro.stdCode); push(out, 'phonestdisdbox_2', ro.phone); push(out, 'correspondenceaddress_faxDetails', ro.fax);
    push(out, 'countryCode_4A', ro.countryCode || '+91');
    push(out, 'correspondenceaddress_MobileNumber', ro.mobile, { note: 'OTP verification must be done manually.' });
    push(out, 'correspondenceaddress_emailID', ro.email, { note: 'OTP verification must be done manually.' });
    push(out, 'correspondenceaddressradiobuttonb2', YN(ro.sameAsCorrespondence === undefined ? true : ro.sameAsCorrespondence));
    push(out, 'correspondenceaddress_longitudeifY', ro.longitude); push(out, 'correspondenceaddress_latitudeifYe', ro.latitude);
    push(out, 'facorrespondenceaddress_proposedCo', ro.rocOffice, { waitForOptions: true });

    // Section 3 — Subscriber and director counts
    const ind = subs.filter((s) => s.kind !== 'bodyCorporate'), corp = subs.filter((s) => s.kind === 'bodyCorporate');
    const cnt = (list, f) => String(list.filter(f).length);
    push(out, 'totalNumberOfFirstSubsMOAHavingVal', cnt(ind, (s) => !!s.din));
    push(out, 'SubsrciberCountWithoutDIN', cnt(ind, (s) => !s.din));
    push(out, 'NonIndividualCountWithoutDIN', cnt(corp, () => true));
    push(out, 'DirectorDINCount', cnt(ind, (s) => s.isDirector && !!s.din));
    push(out, 'FirstSubCumDirectorsNotHavingValid', cnt(ind, (s) => s.isDirector && !s.din));
    push(out, 'directorsWhoIsNotSubscriberHavingV', cnt(dirs, (d) => !!d.din));
    push(out, 'DirectorSubscriberWithoutDINCount', cnt(dirs, (d) => !d.din));

    // Section 4 — Subscribers (6a body corporate, 6b individual with DIN, 6c individual without DIN)
    corp.forEach((s, i) => {
      const inst = { instance: i };
      push(out, 'category6c', s.category, inst); push(out, 'cin6a', s.cin, inst); push(out, 'Cname6a', s.name, inst);
      address(out, s.address, { line1: 'pline1', line2: 'pline2', country: 'country6a', pincode: 'pincode6p', area: 'area6a', city: 'city6a', district: 'district6a', state: 'state6a', phone: 'phonestdisdbox1641296396443', fax: 'fax' }, inst);
      push(out, 'pemail6a', s.email, inst);
      const r = s.representative || {};
      push(out, 'din6a', r.din, inst);
      person(out, r, { firstName: 'firstName6a', middleName: 'middleName6a', surName: 'surName6a', fatherFirstName: 'fatherFirstName6a', fatherMiddleName: 'fatherMiddleName6a', fatherSurName: 'fatherSurName6a', nationality: 'nationality6a', gender: 'gender6a', dob: 'date6a', pan: 'pan6a', placeOfBirth: 'placeOfBirth6a', occupationType: 'OccupationType__1', areaOfOccupation: 'areaOfOccupation__1', othersOccupation: 'othersOccupation__1', education: 'educationalQualification__1', othersEducation: 'othersEducation__1' }, inst);
      address(out, r.presentAddress, { line1: 'Line16a', line2: 'line26a', country: 'country6a1', pincode: 'pincode6a', area: 'area6a1', city: 'city6a1', district: 'district6a1', state: 'state6a1', phone: 'phone6a', fax: 'fax6a' }, inst);
      push(out, 'emailid6a', r.email, inst); push(out, 'year', num(r.stayYears), inst); push(out, 'month', num(r.stayMonths), inst); push(out, 'previousaddress', r.previousAddress, inst);
      push(out, 'identityProofField__1', get(r, 'identityProof.type'), inst); push(out, 'identityprrofNumberField__1', get(r, 'identityProof.number'), inst);
      push(out, 'Residentialproof', get(r, 'residentialProof.type'), inst); push(out, 'residentialProofNumberField__1', get(r, 'residentialProof.number'), inst);
      push(out, 'class6ae', get(s, 'shares.equity.class') || 'Equity', inst); push(out, 'tableItem12__1', num(get(s, 'shares.equity.number')), inst);
    });
    ind.filter((s) => !!s.din).forEach((s, i) => {
      const inst = { instance: i };
      push(out, 'din6b', s.din, Object.assign({ note: 'Portal prefills name from DIN.' }, inst));
      push(out, 'class6be', get(s, 'shares.equity.class') || 'Equity', inst); push(out, 'noofequityshares6b', num(get(s, 'shares.equity.number')), inst);
      if (get(s, 'shares.preference.number')) { push(out, 'class6bp', get(s, 'shares.preference.class'), inst); push(out, 'tableItem12__3', num(get(s, 'shares.preference.number')), inst); }
    });
    ind.filter((s) => !s.din).forEach((s, i) => {
      const inst = { instance: i };
      person(out, s, { firstName: 'firstName6c', middleName: 'middleName6c', surName: 'surName6c', fatherFirstName: 'fatherFirstName', fatherMiddleName: 'fatherMiddleName', fatherSurName: 'fatherSurName', gender: 'gender6c', dob: 'date6c', nationality: 'nationality', placeOfBirth: 'placeOfBirth', occupationType: 'OccupationType__2', areaOfOccupation: 'areaOfOccupation6c', othersOccupation: 'othersOccupation__2', education: 'educationalQualification__2', othersEducation: 'othersEducation__2', pan: 'pan6c' }, inst);
      push(out, 'textbox1641292661235', s.email, inst);
      address(out, s.permanentAddress, { line1: 'line6cp', line2: 'line26cp', country: 'country6c', pincode: 'pinCode6c', area: 'area6b', city: 'city6b', district: 'district6b', state: 'state6b', phone: 'phone6c' }, inst);
      push(out, 'radioButton_perAdd_For6C', YN(s.presentAddressSame === undefined ? true : s.presentAddressSame), inst);
      if (s.presentAddressSame === false) address(out, s.presentAddress, { line1: 'line6ca', line2: 'line26ca', country: 'countryp6b', pincode: 'pinCode6ca', area: 'areap6b', city: 'cityp6b', district: 'districtp6b', state: 'statep6b', phone: 'phonep6c' }, inst);
      push(out, 'years__1', num(s.stayYears), inst); push(out, 'months__1', num(s.stayMonths), inst); push(out, 'previousAddress__1', s.previousAddress, inst);
      push(out, 'identityProofField__2', get(s, 'identityProof.type'), inst); push(out, 'identityprrofNumberField__2', get(s, 'identityProof.number'), inst);
      push(out, 'identityProofField_copy_1__1', get(s, 'residentialProof.type'), inst); push(out, 'residentialProofNumberField__2', get(s, 'residentialProof.number'), inst);
      push(out, 'class6ce', get(s, 'shares.equity.class') || 'Equity', inst); push(out, 'tableItem12__4', num(get(s, 'shares.equity.number')), inst);
    });

    // Section 5 — Directors (7a with DIN, 7b without DIN). Subscriber-cum-directors are also listed here by the portal.
    const allDirs = ind.filter((s) => s.isDirector).concat(dirs);
    allDirs.filter((d) => !!d.din).forEach((d, i) => {
      const inst = { instance: i };
      push(out, 'din7a', d.din, inst); push(out, 'designation7a_1', d.designation || 'Director', inst); push(out, 'category7a_1', d.category || 'Promoter', inst);
      push(out, 'textbox_5764929181641475468184__1', d.nomineeOf, inst);
      push(out, 'classe7a', get(d, 'shares.equity.class') || 'Equity', inst); push(out, 'equityshares7a', num(get(d, 'shares.equity.number')), inst);
      push(out, 'numberOfEntitiesDirectorInterest7a', num((d.interests || []).length), inst);
      (d.interests || []).forEach((it, j) => { const ii = { instance: j }; push(out, 'cin7a', it.cin, ii); push(out, 'Cname7a__2', it.name, ii); push(out, 'Raddress7a', it.address, ii); push(out, 'Designation7a', it.designation, ii); push(out, 'percentageOfShareholding7a', num(it.percent), ii); push(out, 'amount7a', num(it.amount), ii); });
    });
    allDirs.filter((d) => !d.din).forEach((d, i) => {
      const inst = { instance: i };
      person(out, d, { firstName: 'firstName7bp', middleName: 'middleName7bp', surName: 'surName7b', fatherFirstName: 'fatherFirstName7b', fatherMiddleName: 'fatherMiddleName7b', fatherSurName: 'fatherSurName7b', gender: 'gender7b', dob: 'date7b', nationality: 'nationality7b', placeOfBirth: 'placeOfBirth7b', occupationType: 'OccupationType7b', areaOfOccupation: 'areaOfOccupation7b', othersOccupation: 'othersOccupation7b', education: 'educationalQualification7b', othersEducation: 'othersEducation7b', pan: 'pan7b' }, inst);
      push(out, 'citizenOfIndia7b', YN(d.citizenOfIndia ?? true), inst); push(out, 'residentInIndia7b', YN(d.residentInIndia ?? true), inst);
      push(out, 'designation7b_1', d.designation || 'Director', inst); push(out, 'category_7b', d.category || 'Promoter', inst); push(out, 'companyOrInstitutionName7b', d.nomineeOf, inst);
      push(out, 'countryCode_7B', d.countryCode || '+91', inst); push(out, 'mobile7b', d.mobile, inst); push(out, 'emailID7b', d.email, inst);
      address(out, d.permanentAddress, { line1: 'line17bp', line2: 'line27bp', country: 'country7b1', pincode: 'pinCode7bp', area: 'area7b1', city: 'city7b1', district: 'district7b1', state: 'state7b1', phone: 'phone7b1' }, inst);
      push(out, 'isPresentAddressSame7b', YN(d.presentAddressSame ?? true), inst);
      if (d.presentAddressSame === false) address(out, d.presentAddress, { line1: 'line17ba', line2: 'line27ba', country: 'country7b2', pincode: 'pinCode7b2', area: 'area7b2', city: 'city7b2', district: 'district7b2', state: 'state7b2', phone: 'phone7b2' }, inst);
      push(out, 'years7b', num(d.stayYears), inst); push(out, 'months7b', num(d.stayMonths), inst); push(out, 'previousAddress7b', d.previousAddress, inst);
    });
    return out;
  }

  /* ---------------- AGILE-PRO-S (INC-35) ---------------- */
  function agilePro(pf) {
    const a = pf.agile || {}, ro = pf.registeredOffice || {}; const out = [];
    push(out, 'block1-wantToApplyForGSTIN', YN(a.applyGstin ?? false));
    push(out, 'block1-stateJurisdiction', a.stateJurisdiction, { waitForOptions: true }); push(out, 'block1-sector', a.sector, { waitForOptions: true });
    push(out, 'block1-commissionerate', a.commissionerate, { waitForOptions: true }); push(out, 'block1-division', a.division, { waitForOptions: true }); push(out, 'block1-range', a.range, { waitForOptions: true });
    push(out, 'block1-reasonToObtainRegistration', a.reasonToObtainRegistration);
    push(out, 'block1-establishmentOnLease', YN(a.establishmentOnLease ?? false));
    push(out, 'block1-establishmentOnLeaseFromDat', a.leaseFrom); push(out, 'block1-establishmentOnLeaseToDate', a.leaseTo);
    push(out, 'block1-natureOfPossessionOfPremise', a.natureOfPossession); push(out, 'block1-ifOtherNatureOfPossessionOf', a.natureOfPossessionOther);
    push(out, 'block1-proofOfPrincipal', a.proofOfPrincipalPlace);
    push(out, 'block1-premisesEstablishmentIsOwne', a.premisesOwnedBy);
    push(out, 'block1-ifHiredOrNameChngOfUnit', YN(a.hiredOrNameChange ?? false));
    push(out, 'block2-optionForComposition', YN(a.composition ?? false));
    push(out, 'block2-primary-business-activity', a.primaryBusinessActivity); push(out, 'block2-epforegistration', a.primaryBusinessActivityOther);
    push(out, 'block2-9b-exact-nature-of-work', a.exactNatureOfWork, { waitForOptions: true }); push(out, 'b2-work-sub-category-for-esic', a.workSubCategory, { waitForOptions: true });
    push(out, 'b2-nature-of-work-business', a.natureOfWorkBusiness);
    push(out, 'b2-search-hsn-code', a.hsnCode); push(out, 'b2-hsn-code-dropdown', a.hsnCode, { waitForOptions: true }); push(out, 'b2-description-of-goods', a.goodsDescription);
    push(out, 'b3-number-of-director', num(a.numberOfDirectors ?? (pf.directors || []).length + (pf.subscribers || []).filter((s) => s.isDirector).length));
    const s = a.authorizedSignatory || {};
    push(out, 'Directornamelist', s.name, { waitForOptions: true });
    push(out, 'directormobile', s.mobile, { note: 'OTP verification manual.' }); push(out, 'directoremail', s.email, { note: 'OTP verification manual.' });
    (a.otherDirectors || []).forEach((d, i) => { const inst = { instance: i }; push(out, 'Director12BNameList', d.name, Object.assign({ waitForOptions: true }, inst)); push(out, 'b3-12b-2-other-director-mobile', d.mobile, inst); push(out, 'b3-12b-1-other-director-email', d.email, inst); });
    push(out, 'b4-police-station-esic-application', a.policeStation);
    push(out, 'b4-appropriate-branch-office', a.esicBranchOffice, { waitForOptions: true }); push(out, 'b4-select-inspection-office', a.esicInspectionDivision, { waitForOptions: true });
    push(out, 'b4-bankname', a.bankName, { waitForOptions: true });
    const d = a.declarations || {};
    push(out, 'b5-gst-declaration', d.gst ?? true); push(out, 'b5-esic-declaration', d.esic ?? true); push(out, 'b5-professional-tax-declaration', d.pt ?? false); push(out, 'b5-epfo-declaration', d.epfo ?? true); push(out, 'b5-bank-declaration', d.bank ?? true);
    push(out, 'b5-declaration-place', a.declarationPlace || ro.city); push(out, 'b5-declaration-date', a.declarationDate);
    return out;
  }

  /* ---------------- INC-33 e-MoA ---------------- */
  function inc33(pf) {
    const c = pf.company || {}, m = pf.moa || {}, ro = pf.registeredOffice || {}; const out = [];
    push(out, 'tableApplicableToCompany', m.table || 'Table A', { waitForOptions: true });
    push(out, 'nameOfCompany', (c.proposedNames || [])[0] || c.name);
    push(out, 'regOfficeState', ro.state);
    push(out, 'objectsToBePursued', m.objects || c.objects);
    push(out, 'mattersNecessary', m.mattersNecessary || c.mattersNecessary);
    push(out, 'costsChargesExpencesofWindingUp', num(m.windingUpContribution));
    push(out, 'MOAcontent', m.liabilityClause, { waitForOptions: true });
    push(out, 'checkBox1', m.declaration1 ?? true);
    const w = m.witness || {};
    push(out, 'personFullName', w.name); push(out, 'sonDaughter', w.sonDaughter); push(out, 'nameOfParent', w.parentName); push(out, 'resident', w.address); push(out, 'age', num(w.age)); push(out, 'MembershipTypeItem', w.membershipType, { waitForOptions: true });
    return out;
  }

  /* ---------------- INC-34 e-AoA ---------------- */
  function inc34(pf) {
    const m = pf.aoa || {}, w = m.witness || {}; const out = [];
    push(out, 'table_applicable_company', m.table || 'Table F');
    (pf.subscribers || []).forEach((s, i) => { push(out, 'place__' + (i + 1), s.place || get(pf, 'registeredOffice.city')); });
    push(out, 'name', w.name); push(out, 'witnessAddrDescOccpn', w.addressDescriptionOccupation); push(out, 'dinNumber', w.dinPanMembership); push(out, 'place__3', w.place);
    return out;
  }

  const MAPPERS = { 'spice-part-a': partA, 'spice-part-b': partB, 'agile-pro-s': agilePro, 'inc-33-emoa': inc33, 'inc-34-eaoa': inc34, 'inc-9': () => [], login: (pf) => (pf.mcaLogin && pf.mcaLogin.userId ? [{ key: 'userID', value: pf.mcaLogin.userId }] : []) };

  root.VCFO_MAPPING = {
    forms: Object.keys(MAPPERS),
    map(formKey, profile) { const fn = MAPPERS[formKey]; return fn ? fn(profile || {}) : []; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
