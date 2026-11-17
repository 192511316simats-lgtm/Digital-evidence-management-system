import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GENESIS_CUSTODY_HASH,
  buildCanonicalManifest,
  computeCustodyEventHash,
  computeSha256Hex,
  decryptEvidenceBuffer,
  encryptEvidenceBuffer,
  ensureVaultKeyPairs,
  signManifest,
  verifyCustodyChain,
  verifyManifestSignature,
} from './crypto';

test('SHA-256 hashing produces deterministic hex digests and detects 1-byte modification', () => {
  const original = Buffer.from('VERITAS forensic disk image payload v1');
  const modified = Buffer.from('VERITAS forensic disk image payload v2');

  const h1 = computeSha256Hex(original);
  const h2 = computeSha256Hex(original);
  const h3 = computeSha256Hex(modified);

  assert.equal(h1.length, 64);
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test('Hybrid encryption (AES-256-GCM + RSA-OAEP-3072) encrypts, wraps, unwraps, decrypts, and rejects tampered ciphertext', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-keys-'));
  try {
    const { wrappingKeys } = ensureVaultKeyPairs(tmpDir);
    assert.equal(wrappingKeys.modulusLength, 3072);

    const plaintext = Buffer.from('Confidential network packet capture and volatile memory dump.');
    const sha256 = computeSha256Hex(plaintext);
    const evidenceId = 'evd-test-001';

    const enc = encryptEvidenceBuffer(
      plaintext,
      evidenceId,
      sha256,
      wrappingKeys.publicKeyPem,
      wrappingKeys.modulusLength
    );

    assert.equal(enc.aesAlgorithm, 'AES-256-GCM');
    assert.equal(enc.rsaAlgorithm, 'RSA-OAEP-SHA256');
    assert.notEqual(enc.ciphertext.toString('hex'), plaintext.toString('hex'));

    const decrypted = decryptEvidenceBuffer(
      enc.ciphertext,
      {
        ivHex: enc.ivHex,
        authTagHex: enc.authTagHex,
        aad: enc.aad,
        wrappedAesKeyB64: enc.wrappedAesKeyB64,
      },
      wrappingKeys.privateKeyPem
    );

    assert.equal(decrypted.equals(plaintext), true);
    assert.equal(computeSha256Hex(decrypted), sha256);

    // Tamper 1 byte in ciphertext and verify GCM auth tag rejects decryption
    const tamperedCiphertext = Buffer.from(enc.ciphertext);
    tamperedCiphertext[0] = tamperedCiphertext[0] ^ 0xff;

    assert.throws(() => {
      decryptEvidenceBuffer(
        tamperedCiphertext,
        {
          ivHex: enc.ivHex,
          authTagHex: enc.authTagHex,
          aad: enc.aad,
          wrappedAesKeyB64: enc.wrappedAesKeyB64,
        },
        wrappingKeys.privateKeyPem
      );
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('RSA-PSS-SHA256 digital signature validates canonical manifest and detects metadata tampering', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-sign-'));
  try {
    const { signingKeys } = ensureVaultKeyPairs(tmpDir);
    const manifest = buildCanonicalManifest({
      evidenceId: 'evd-100',
      caseId: 'case-200',
      originalFilename: 'firewall_audit.log',
      fileSize: 4096,
      mimeType: 'text/plain',
      sha256Hash: 'a'.repeat(64),
      uploadedBy: 'user-1',
      uploadedAt: '2026-11-17T10:00:00.000Z',
      encryptionAlgorithm: 'AES-256-GCM + RSA-OAEP-SHA256',
    });

    const signature = signManifest(manifest, signingKeys.privateKeyPem);
    assert.equal(verifyManifestSignature(manifest, signature, signingKeys.publicKeyPem), true);

    // Tamper manifest hash
    const tamperedManifest = manifest.replace('a'.repeat(64), 'b'.repeat(64));
    assert.equal(verifyManifestSignature(tamperedManifest, signature, signingKeys.publicKeyPem), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Hash-linked chain of custody validates intact chains and detects broken links or altered descriptions', () => {
  const ts1 = '2026-11-17T10:00:00.000Z';
  const h1 = computeCustodyEventHash({
    previousEventHash: GENESIS_CUSTODY_HASH,
    evidenceId: 'evd-1',
    userId: 'u-1',
    eventType: 'ACQUISITION',
    timestamp: ts1,
    description: 'Acquired sample evidence',
  });

  const ts2 = '2026-11-17T10:01:00.000Z';
  const h2 = computeCustodyEventHash({
    previousEventHash: h1,
    evidenceId: 'evd-1',
    userId: 'u-1',
    eventType: 'ENCRYPTION',
    timestamp: ts2,
    description: 'Encrypted via AES-256-GCM',
  });

  const intact = [
    {
      id: 1,
      evidence_id: 'evd-1',
      user_id: 'u-1',
      event_type: 'ACQUISITION',
      timestamp: ts1,
      description: 'Acquired sample evidence',
      previous_event_hash: GENESIS_CUSTODY_HASH,
      current_event_hash: h1,
    },
    {
      id: 2,
      evidence_id: 'evd-1',
      user_id: 'u-1',
      event_type: 'ENCRYPTION',
      timestamp: ts2,
      description: 'Encrypted via AES-256-GCM',
      previous_event_hash: h1,
      current_event_hash: h2,
    },
  ];

  const validRes = verifyCustodyChain(intact);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.totalEvents, 2);

  // Tamper event 1 description without updating hash
  const tampered = [
    { ...intact[0], description: 'Altered description' },
    intact[1],
  ];
  const invalidRes = verifyCustodyChain(tampered);
  assert.equal(invalidRes.valid, false);
  assert.equal(invalidRes.brokenAtEventId, 1);
});
