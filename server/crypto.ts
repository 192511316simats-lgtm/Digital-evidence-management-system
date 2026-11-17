import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface KeyPairBundle {
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;
  modulusLength: number;
}

export interface HybridEncryptionResult {
  ciphertext: Buffer;
  aesAlgorithm: 'AES-256-GCM';
  ivHex: string;
  authTagHex: string;
  aad: string;
  rsaAlgorithm: 'RSA-OAEP-SHA256';
  rsaKeyBits: number;
  rsaKeyFingerprint: string;
  wrappedAesKeyB64: string;
  encryptedSize: number;
}

export interface EvidenceManifest {
  evidenceId: string;
  caseId: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  sha256Hash: string;
  uploadedBy: string;
  uploadedAt: string;
  encryptionAlgorithm: string;
}

export interface CustodyEventInput {
  id: number;
  evidence_id: string;
  user_id: string;
  event_type: string;
  timestamp: string;
  description: string;
  previous_event_hash: string;
  current_event_hash: string;
}

export interface CustodyValidationResult {
  valid: boolean;
  totalEvents: number;
  brokenAtEventId: number | null;
  reason: string | null;
}

export function computeSha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function computeKeyFingerprint(publicKeyPem: string): string {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 32).toUpperCase();
}

export function ensureVaultKeyPairs(keysDir: string): {
  wrappingKeys: KeyPairBundle;
  signingKeys: KeyPairBundle;
} {
  fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 });

  const wrapPubPath = path.join(keysDir, 'vault-wrap-public.pem');
  const wrapPrivPath = path.join(keysDir, 'vault-wrap-private.pem');
  const signPubPath = path.join(keysDir, 'vault-sign-public.pem');
  const signPrivPath = path.join(keysDir, 'vault-sign-private.pem');

  let wrappingKeys: KeyPairBundle;
  if (fs.existsSync(wrapPubPath) && fs.existsSync(wrapPrivPath)) {
    const publicKeyPem = fs.readFileSync(wrapPubPath, 'utf8');
    const privateKeyPem = fs.readFileSync(wrapPrivPath, 'utf8');
    wrappingKeys = {
      publicKeyPem,
      privateKeyPem,
      fingerprint: computeKeyFingerprint(publicKeyPem),
      modulusLength: 3072,
    };
  } else {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(wrapPubPath, publicKey, { mode: 0o644 });
    fs.writeFileSync(wrapPrivPath, privateKey, { mode: 0o600 });
    wrappingKeys = {
      publicKeyPem: publicKey,
      privateKeyPem: privateKey,
      fingerprint: computeKeyFingerprint(publicKey),
      modulusLength: 3072,
    };
  }

  let signingKeys: KeyPairBundle;
  if (fs.existsSync(signPubPath) && fs.existsSync(signPrivPath)) {
    const publicKeyPem = fs.readFileSync(signPubPath, 'utf8');
    const privateKeyPem = fs.readFileSync(signPrivPath, 'utf8');
    signingKeys = {
      publicKeyPem,
      privateKeyPem,
      fingerprint: computeKeyFingerprint(publicKeyPem),
      modulusLength: 3072,
    };
  } else {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(signPubPath, publicKey, { mode: 0o644 });
    fs.writeFileSync(signPrivPath, privateKey, { mode: 0o600 });
    signingKeys = {
      publicKeyPem: publicKey,
      privateKeyPem: privateKey,
      fingerprint: computeKeyFingerprint(publicKey),
      modulusLength: 3072,
    };
  }

  return { wrappingKeys, signingKeys };
}

export function encryptEvidenceBuffer(
  plaintext: Buffer,
  evidenceId: string,
  sha256Hash: string,
  wrappingPublicKeyPem: string,
  rsaKeyBits = 3072
): HybridEncryptionResult {
  const aesKey = crypto.randomBytes(32); // 256-bit AES key
  const iv = crypto.randomBytes(12); // 96-bit GCM nonce
  const aad = `${evidenceId}|${sha256Hash}`;

  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const wrappedAesKey = crypto.publicEncrypt(
    {
      key: wrappingPublicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey
  );

  // Zero out raw AES key buffer after wrapping
  aesKey.fill(0);

  return {
    ciphertext,
    aesAlgorithm: 'AES-256-GCM',
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    aad,
    rsaAlgorithm: 'RSA-OAEP-SHA256',
    rsaKeyBits,
    rsaKeyFingerprint: computeKeyFingerprint(wrappingPublicKeyPem),
    wrappedAesKeyB64: wrappedAesKey.toString('base64'),
    encryptedSize: ciphertext.length,
  };
}

export function decryptEvidenceBuffer(
  ciphertext: Buffer,
  metadata: {
    ivHex: string;
    authTagHex: string;
    aad: string;
    wrappedAesKeyB64: string;
  },
  wrappingPrivateKeyPem: string
): Buffer {
  const wrappedKey = Buffer.from(metadata.wrappedAesKeyB64, 'base64');
  const aesKey = crypto.privateDecrypt(
    {
      key: wrappingPrivateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrappedKey
  );

  try {
    const iv = Buffer.from(metadata.ivHex, 'hex');
    const authTag = Buffer.from(metadata.authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAAD(Buffer.from(metadata.aad, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } finally {
    aesKey.fill(0);
  }
}

export function buildCanonicalManifest(manifest: EvidenceManifest): string {
  const ordered = {
    caseId: manifest.caseId,
    encryptionAlgorithm: manifest.encryptionAlgorithm,
    evidenceId: manifest.evidenceId,
    fileSize: manifest.fileSize,
    mimeType: manifest.mimeType,
    originalFilename: manifest.originalFilename,
    sha256Hash: manifest.sha256Hash,
    uploadedAt: manifest.uploadedAt,
    uploadedBy: manifest.uploadedBy,
  };
  return JSON.stringify(ordered);
}

export function signManifest(
  manifestJson: string,
  signingPrivateKeyPem: string
): string {
  const signature = crypto.sign(
    'sha256',
    Buffer.from(manifestJson, 'utf8'),
    {
      key: signingPrivateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }
  );
  return signature.toString('base64');
}

export function verifyManifestSignature(
  manifestJson: string,
  signatureB64: string,
  signingPublicKeyPem: string
): boolean {
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(manifestJson, 'utf8'),
      {
        key: signingPublicKeyPem,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      },
      Buffer.from(signatureB64, 'base64')
    );
  } catch {
    return false;
  }
}

export const GENESIS_CUSTODY_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

export function computeCustodyEventHash(params: {
  previousEventHash: string;
  evidenceId: string;
  userId: string;
  eventType: string;
  timestamp: string;
  description: string;
}): string {
  const payload = [
    params.previousEventHash,
    params.evidenceId,
    params.userId,
    params.eventType,
    params.timestamp,
    params.description,
  ].join('|');
  return computeSha256Hex(payload);
}

export function verifyCustodyChain(events: CustodyEventInput[]): CustodyValidationResult {
  if (events.length === 0) {
    return {
      valid: true,
      totalEvents: 0,
      brokenAtEventId: null,
      reason: null,
    };
  }

  let expectedPreviousHash = GENESIS_CUSTODY_HASH;

  for (const event of events) {
    if (event.previous_event_hash !== expectedPreviousHash) {
      return {
        valid: false,
        totalEvents: events.length,
        brokenAtEventId: event.id,
        reason: `Previous hash mismatch at event #${event.id} (${event.event_type})`,
      };
    }

    const recomputed = computeCustodyEventHash({
      previousEventHash: event.previous_event_hash,
      evidenceId: event.evidence_id,
      userId: event.user_id,
      eventType: event.event_type,
      timestamp: event.timestamp,
      description: event.description,
    });

    if (event.current_event_hash !== recomputed) {
      return {
        valid: false,
        totalEvents: events.length,
        brokenAtEventId: event.id,
        reason: `Event payload hash mismatch at event #${event.id} (${event.event_type})`,
      };
    }

    expectedPreviousHash = event.current_event_hash;
  }

  return {
    valid: true,
    totalEvents: events.length,
    brokenAtEventId: null,
    reason: null,
  };
}
