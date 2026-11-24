// Writes fixtures/gst-engagement.json: a GST REG-01 assist profile in the shape
// of docs/gst-profile-contract.md, with invented data only (no real person, PAN,
// mobile or email). Documents are tiny generated files carried as data: URLs so
// the fixture works offline. Run: node tools/build-gst-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A one-page PDF and a 1x1 JPEG, both a few hundred bytes.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

function doc(key, label, fileName, contentType, bytes, portalLimitKb) {
  return {
    key, label, fileName, contentType, sizeBytes: bytes.length,
    url: `data:${contentType};base64,${bytes.toString('base64')}`,
    expiresAt: '2099-01-01T00:00:00.000Z', source: 'checklist', portalLimitKb,
  };
}

const promoter = (n, first, last, father, gender, din, signatory) => ({
  [`promoters.${n}.firstName`]: first,
  [`promoters.${n}.lastName`]: last,
  [`promoters.${n}.fatherFirstName`]: father,
  [`promoters.${n}.fatherLastName`]: last,
  [`promoters.${n}.dob`]: n === 1 ? '14/02/1985' : '03/09/1988',
  [`promoters.${n}.mobile`]: `900000000${n}`,
  [`promoters.${n}.email`]: `director${n}@example.test`,
  [`promoters.${n}.gender`]: gender,
  [`promoters.${n}.designation`]: 'Director',
  [`promoters.${n}.din`]: `0000000${n}`,
  [`promoters.${n}.citizenOfIndia`]: true,
  [`promoters.${n}.pan`]: n === 1 ? 'ABCPT0001A' : 'ABCPT0002B',
  [`promoters.${n}.address.country`]: 'India',
  [`promoters.${n}.address.pincode`]: '500081',
  [`promoters.${n}.address.state`]: 'Telangana',
  [`promoters.${n}.address.district`]: 'Hyderabad',
  [`promoters.${n}.address.city`]: 'Hyderabad',
  [`promoters.${n}.address.locality`]: 'Madhapur',
  [`promoters.${n}.address.road`]: 'Fixture Road',
  [`promoters.${n}.address.building`]: `${n}-1-${n}0`,
  [`promoters.${n}.isPrimarySignatory`]: signatory,
});

const fields = {
  'partA.applicantType': 'Taxpayer',
  'partA.state': 'Telangana',
  'partA.district': 'Hyderabad',
  'partA.legalName': 'EXAMPLE FIXTURE VENTURES PRIVATE LIMITED',
  'partA.pan': 'AAACE0000F',
  'partA.email': 'accounts@example.test',
  'partA.mobile': '9000000000',
  'business.tradeName': 'Fixture Ventures',
  'business.constitution': 'Private Limited Company',
  'business.casualTaxable': false,
  'business.compositionOpted': false,
  'business.reason': 'Voluntary Basis',
  'business.commencementDate': '01/11/2026',
  'business.constitutionProofType': 'Certificate of Incorporation',
  'existingRegistrations.1.type': 'Corporate Identity Number/Foreign Company Registration Number',
  'existingRegistrations.1.number': 'U62011TS2026PTC000000',
  'existingRegistrations.1.date': '20/10/2026',
  ...promoter(1, 'Asha', 'Fixture', 'Ravi', 'Female', '1', true),
  ...promoter(2, 'Kiran', 'Example', 'Mohan', 'Male', '2', false),
  'signatory.promoterIndex': 1,
  'signatory.isPrimarySignatory': true,
  'signatory.firstName': 'Asha',
  'signatory.lastName': 'Fixture',
  'signatory.fatherFirstName': 'Ravi',
  'signatory.fatherLastName': 'Fixture',
  'signatory.dob': '14/02/1985',
  'signatory.mobile': '9000000001',
  'signatory.email': 'director1@example.test',
  'signatory.gender': 'Female',
  'signatory.designation': 'Director',
  'signatory.din': '00000001',
  'signatory.citizenOfIndia': true,
  'signatory.pan': 'ABCPT0001A',
  'signatory.address.country': 'India',
  'signatory.address.pincode': '500081',
  'signatory.address.state': 'Telangana',
  'signatory.address.district': 'Hyderabad',
  'signatory.address.city': 'Hyderabad',
  'signatory.address.road': 'Fixture Road',
  'signatory.address.building': '1-1-10',
  'signatory.proofDocType': 'Copy of resolution passed by BoD / Managing Committee',
  'principalPlace.address.pincode': '500081',
  'principalPlace.address.district': 'Hyderabad',
  'principalPlace.address.city': 'Hyderabad',
  'principalPlace.address.locality': 'Madhapur',
  'principalPlace.address.road': 'Example Street',
  'principalPlace.address.premises': 'Fixture Towers',
  'principalPlace.address.building': '8-2-100',
  'principalPlace.address.floor': '4',
  'principalPlace.email': 'office@example.test',
  'principalPlace.mobile': '9000000000',
  'principalPlace.possession': 'Rented/Leased',
  'principalPlace.proofDocType': 'Rent / Lease agreement',
  'principalPlace.activities': 'Office / Sale Office; Supplier of Services',
  'principalPlace.hasAdditionalPlaces': false,
  'business.jurisdiction.commissionerate': 'HYDERABAD',
  'goods.1.hsn': '8471',
  'goods.1.description': 'Automatic data processing machines',
  'services.1.sac': '998314',
  'services.1.description': 'IT design and development services',
  'services.2.sac': '998313',
  'services.2.description': 'IT consulting and support services',
  'stateSpecific.professionalTaxEc': 'PTEC0000001',
  'verification.signatoryName': 'Asha Fixture',
  'verification.place': 'Hyderabad',
};

const profile = {
  ok: true,
  schemaVersion: 1,
  form: 'gst-reg-01',
  engagement: { id: 'fixture-gst', slug: 'example-fixture-ventures', companyName: 'Example Fixture Ventures Private Limited' },
  companyName: 'Example Fixture Ventures Private Limited',
  issuedAt: '2026-11-25T00:00:00.000Z',
  profile: { partA: { legalName: fields['partA.legalName'] }, _note: 'Invented data for the offline tests and the mock portal.' },
  fields,
  documents: [
    doc('company.coi', 'Certificate of incorporation', 'certificate-of-incorporation.pdf', 'application/pdf', PDF, 1024),
    doc('promoter.1.photo', 'Photograph of Asha Fixture', 'asha-fixture.jpg', 'image/jpeg', JPEG, 100),
    doc('promoter.2.photo', 'Photograph of Kiran Example', 'kiran-example.jpg', 'image/jpeg', JPEG, 100),
    doc('signatory.proof', 'Board resolution authorising the signatory', 'board-resolution.pdf', 'application/pdf', PDF, 1024),
    doc('place.proof', 'Rent agreement for the principal place', 'rent-agreement.pdf', 'application/pdf', PDF, 2000),
  ],
  missing: [],
  notes: [{ key: 'fixture', note: 'Development fixture: invented data only.' }],
  readiness: { ready: true, missingValues: 0, missingDocuments: 0 },
};

const out = path.join(ROOT, 'fixtures', 'gst-engagement.json');
fs.writeFileSync(out, `${JSON.stringify(profile, null, 2)}\n`);
console.log(`wrote ${path.relative(ROOT, out)} (${Object.keys(fields).length} fields, ${profile.documents.length} documents)`);
