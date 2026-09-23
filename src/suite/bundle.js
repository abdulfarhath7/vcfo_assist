// `.vcfoa` bundle import — the fallback for a machine that cannot reach
// Suite. The envelope is AES-GCM encrypted JSON with a PBKDF2-derived key.
// Decryption happens in memory; the plaintext goes to chrome.storage.session
// and the file contents are discarded by the caller.

import { Ok, Err, fromThrown } from '../shared/result.js';
import { BUNDLE } from '../shared/constants.js';
import { isRecord, Problems } from '../shared/check.js';

/** @typedef {import('../shared/schema.js').BundleEnvelope} BundleEnvelope */

/**
 * @param {string} b64
 * @returns {Uint8Array<ArrayBuffer>}
 */
function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Parse and structurally validate an envelope. The file's text is expected
 * to be JSON; a `.vcfoa` is that JSON and nothing else.
 * @param {unknown} raw   Parsed JSON, or the file text
 * @returns {import('../shared/result.js').Result<BundleEnvelope>}
 */
export function parseEnvelope(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return Err('validation', 'The selected file is not a .vcfoa bundle (not valid JSON).');
    }
  }
  const p = new Problems('bundle');
  if (!isRecord(obj)) return Err('validation', 'The selected file is not a .vcfoa bundle.');
  const format = p.oneOf(obj, 'format', [BUNDLE.format]);
  const version = p.int(obj, 'version');
  if (version !== undefined && !BUNDLE.versions.includes(version)) {
    p.add('version', `must be one of ${BUNDLE.versions.join(', ')}`);
  }
  const manifestRaw = p.record(obj, 'manifest');
  /** @type {BundleEnvelope['manifest'] | undefined} */
  let manifest;
  if (manifestRaw) {
    const issuedAt = p.string(manifestRaw, 'issuedAt', 'manifest.issuedAt');
    const expiresAt = p.string(manifestRaw, 'expiresAt', 'manifest.expiresAt');
    const form = p.string(manifestRaw, 'form', 'manifest.form');
    const engagementId = p.string(manifestRaw, 'engagementId', 'manifest.engagementId');
    if (issuedAt !== undefined && expiresAt !== undefined && form !== undefined && engagementId !== undefined) {
      manifest = { issuedAt, expiresAt, form, engagementId };
    }
  }
  const kdfRaw = p.record(obj, 'kdf');
  /** @type {BundleEnvelope['kdf'] | undefined} */
  let kdf;
  if (kdfRaw) {
    const name = p.oneOf(kdfRaw, 'name', ['PBKDF2'], 'kdf.name');
    const salt = p.string(kdfRaw, 'salt', 'kdf.salt');
    const iterations = p.int(kdfRaw, 'iterations', 'kdf.iterations');
    const hash = p.oneOf(kdfRaw, 'hash', ['SHA-256'], 'kdf.hash');
    if (name !== undefined && salt !== undefined && iterations !== undefined && hash !== undefined) {
      kdf = { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' };
    }
  }
  const cipherRaw = p.record(obj, 'cipher');
  /** @type {BundleEnvelope['cipher'] | undefined} */
  let cipher;
  if (cipherRaw) {
    const name = p.oneOf(cipherRaw, 'name', ['AES-GCM'], 'cipher.name');
    const iv = p.string(cipherRaw, 'iv', 'cipher.iv');
    if (name !== undefined && iv !== undefined) cipher = { name: 'AES-GCM', iv };
  }
  const ciphertext = p.string(obj, 'ciphertext');
  if (p.any) return Err('validation', `Bundle failed validation: ${p.list.join('; ')}`, { missing: p.list });
  if (format === undefined || version === undefined || manifest === undefined || kdf === undefined
    || cipher === undefined || ciphertext === undefined) {
    return Err('validation', 'Bundle failed validation');
  }
  return Ok({ format: 'vcfoa', version, manifest, kdf, cipher, ciphertext });
}

/**
 * Refuse a bundle past its expiry. Checked before any decryption.
 * @param {BundleEnvelope} envelope
 * @param {Date} [now]
 * @returns {import('../shared/result.js').Result<true>}
 */
export function checkExpiry(envelope, now = new Date()) {
  const t = Date.parse(envelope.manifest.expiresAt);
  if (Number.isNaN(t)) return Err('validation', `Bundle expiresAt "${envelope.manifest.expiresAt}" is not a valid date.`);
  if (t < now.getTime()) {
    return Err('validation', `Bundle expired at ${envelope.manifest.expiresAt}. Export a fresh bundle from VCFO Suite.`);
  }
  return Ok(true);
}

/**
 * Derive the AES-GCM key from the passphrase and the envelope's KDF params.
 * @param {string} passphrase
 * @param {BundleEnvelope['kdf']} kdf
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(passphrase, kdf) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(kdf.salt), iterations: kdf.iterations, hash: kdf.hash },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

/**
 * Decrypt the envelope and parse the plaintext as JSON. A wrong passphrase
 * surfaces as a named error, not a crash. The result is the raw payload; the
 * caller validates it exactly as a live fetch.
 * @param {BundleEnvelope} envelope
 * @param {string} passphrase
 * @returns {Promise<import('../shared/result.js').Result<unknown>>}
 */
export async function decryptBundle(envelope, passphrase) {
  if (passphrase.length === 0) return Err('validation', 'Enter the bundle passphrase shown in VCFO Suite.');
  const expiry = checkExpiry(envelope);
  if (!expiry.ok) return expiry;
  let key;
  try {
    key = await deriveKey(passphrase, envelope.kdf);
  } catch (e) {
    return fromThrown('internal', e, 'Could not derive the bundle key');
  }
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.cipher.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
  } catch {
    return Err('validation', 'The bundle could not be decrypted. Check the passphrase; it is case-sensitive.');
  }
  try {
    return Ok(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    return Err('validation', 'The bundle decrypted but its contents are not valid JSON.');
  }
}
