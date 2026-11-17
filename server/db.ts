import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  GENESIS_CUSTODY_HASH,
  computeCustodyEventHash,
} from './crypto';

export function getDataDir(): string {
  const configured = process.env.VERITAS_DATA_DIR || './data';
  return path.resolve(process.cwd(), configured);
}

export function getVaultDir(): string {
  return path.join(getDataDir(), 'vault');
}

export function getKeysDir(): string {
  return path.join(getDataDir(), 'keys');
}

export function initDatabase(dbPathOverride?: string): Database.Database {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(getVaultDir(), { recursive: true, mode: 0o700 });
  fs.mkdirSync(getKeysDir(), { recursive: true, mode: 0o700 });

  const dbPath = dbPathOverride || path.join(dataDir, 'veritas.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      badge_number TEXT NOT NULL UNIQUE,
      department TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'INVESTIGATOR')),
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'DISABLED')),
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      user_id TEXT,
      success INTEGER NOT NULL CHECK (success IN (0, 1)),
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      reason TEXT,
      attempted_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      case_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACTIVE', 'UNDER_REVIEW', 'CLOSED', 'ARCHIVED')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS case_assignments (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      assigned_by TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      UNIQUE (case_id, user_id),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      evidence_code TEXT NOT NULL UNIQUE,
      case_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      safe_storage_name TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      sha256_hash TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      encryption_status TEXT NOT NULL CHECK (encryption_status IN ('PENDING', 'ENCRYPTED', 'FAILED')),
      integrity_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (integrity_status IN ('PENDING', 'INTEGRITY VERIFIED', 'INTEGRITY MISMATCH', 'VERIFICATION FAILED')),
      signature_status TEXT NOT NULL DEFAULT 'UNAVAILABLE' CHECK (signature_status IN ('UNAVAILABLE', 'VALID', 'INVALID')),
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS encryption_metadata (
      id TEXT PRIMARY KEY,
      evidence_id TEXT NOT NULL UNIQUE,
      aes_algorithm TEXT NOT NULL,
      iv_hex TEXT NOT NULL,
      auth_tag_hex TEXT NOT NULL,
      aad TEXT NOT NULL,
      rsa_algorithm TEXT NOT NULL,
      rsa_key_bits INTEGER NOT NULL,
      rsa_key_fingerprint TEXT NOT NULL,
      wrapped_aes_key_b64 TEXT NOT NULL,
      encrypted_size INTEGER NOT NULL,
      encrypted_at TEXT NOT NULL,
      FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS digital_signatures (
      id TEXT PRIMARY KEY,
      evidence_id TEXT NOT NULL,
      signer_id TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      signature_b64 TEXT NOT NULL,
      public_key_pem TEXT NOT NULL,
      key_fingerprint TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      last_verified_at TEXT,
      last_verification_result TEXT CHECK (last_verification_result IN ('VALID', 'INVALID', 'UNAVAILABLE')),
      FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE,
      FOREIGN KEY (signer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS integrity_verification (
      id TEXT PRIMARY KEY,
      evidence_id TEXT NOT NULL,
      verified_by TEXT NOT NULL,
      expected_sha256 TEXT NOT NULL,
      calculated_sha256 TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('INTEGRITY VERIFIED', 'INTEGRITY MISMATCH', 'VERIFICATION FAILED')),
      details TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE,
      FOREIGN KEY (verified_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS chain_of_custody (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      description TEXT NOT NULL,
      previous_event_hash TEXT NOT NULL,
      current_event_hash TEXT NOT NULL,
      FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      actor_email TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILURE', 'WARNING')),
      ip_address TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, attempted_at);
    CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
    CREATE INDEX IF NOT EXISTS idx_case_assignments_user ON case_assignments(user_id);
    CREATE INDEX IF NOT EXISTS idx_case_assignments_case ON case_assignments(case_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_uploaded_by ON evidence(uploaded_by);
    CREATE INDEX IF NOT EXISTS idx_custody_evidence ON chain_of_custody(evidence_id, id);
    CREATE INDEX IF NOT EXISTS idx_integrity_evidence ON integrity_verification(evidence_id, verified_at);
    CREATE INDEX IF NOT EXISTS idx_signatures_evidence ON digital_signatures(evidence_id, signed_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);
  `);

  return db;
}

export function appendCustodyEvent(
  db: Database.Database,
  params: {
    evidenceId: string;
    userId: string;
    eventType: string;
    description: string;
    timestamp?: string;
  }
): {
  id: number;
  timestamp: string;
  previousEventHash: string;
  currentEventHash: string;
} {
  const timestamp = params.timestamp || new Date().toISOString();
  const lastRow = db
    .prepare(
      'SELECT current_event_hash FROM chain_of_custody WHERE evidence_id = ? ORDER BY id DESC LIMIT 1'
    )
    .get(params.evidenceId) as { current_event_hash: string } | undefined;

  const previousEventHash = lastRow ? lastRow.current_event_hash : GENESIS_CUSTODY_HASH;
  const currentEventHash = computeCustodyEventHash({
    previousEventHash,
    evidenceId: params.evidenceId,
    userId: params.userId,
    eventType: params.eventType,
    timestamp,
    description: params.description,
  });

  const info = db
    .prepare(
      `INSERT INTO chain_of_custody (
        evidence_id, user_id, event_type, timestamp, description, previous_event_hash, current_event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.evidenceId,
      params.userId,
      params.eventType,
      timestamp,
      params.description,
      previousEventHash,
      currentEventHash
    );

  return {
    id: Number(info.lastInsertRowid),
    timestamp,
    previousEventHash,
    currentEventHash,
  };
}

export function recordAuditLog(
  db: Database.Database,
  params: {
    userId?: string | null;
    actorEmail: string;
    actorRole: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    status: 'SUCCESS' | 'FAILURE' | 'WARNING';
    ipAddress: string;
    details: string;
  }
): void {
  db.prepare(
    `INSERT INTO audit_logs (
      user_id, actor_email, actor_role, action, resource_type, resource_id, status, ip_address, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.userId ?? null,
    params.actorEmail,
    params.actorRole,
    params.action,
    params.resourceType,
    params.resourceId ?? null,
    params.status,
    params.ipAddress,
    params.details,
    new Date().toISOString()
  );
}
