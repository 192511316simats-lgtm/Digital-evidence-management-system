export type UserRole = 'ADMIN' | 'INVESTIGATOR';
export type UserStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED';

export interface User {
  id: string;
  name: string;
  email: string;
  badgeNumber: string;
  department: string;
  role: UserRole;
  status: UserStatus;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  badge_number: string;
  department: string;
  role: UserRole;
  status: UserStatus;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseRecord {
  id: string;
  case_code: string;
  title: string;
  description: string;
  category: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'ACTIVE' | 'UNDER_REVIEW' | 'CLOSED' | 'ARCHIVED';
  created_by: string;
  created_by_name?: string;
  created_by_badge?: string;
  created_at: string;
  updated_at: string;
  evidence_count?: number;
  assigned_investigators?: string | null;
}

export interface EvidenceRecord {
  id: string;
  evidence_code: string;
  case_id: string;
  case_code?: string;
  case_title?: string;
  case_priority?: string;
  case_status?: string;
  original_filename: string;
  safe_storage_name: string;
  file_size: number;
  mime_type: string;
  sha256_hash: string;
  uploaded_by: string;
  uploader_name?: string;
  uploader_badge?: string;
  uploader_email?: string;
  uploaded_at: string;
  encryption_status: 'PENDING' | 'ENCRYPTED' | 'FAILED';
  integrity_status: 'PENDING' | 'INTEGRITY VERIFIED' | 'INTEGRITY MISMATCH' | 'VERIFICATION FAILED';
  signature_status: 'UNAVAILABLE' | 'VALID' | 'INVALID';
  notes: string;
}

export interface EncryptionMetadata {
  id: string;
  evidence_id: string;
  aes_algorithm: string;
  iv_hex: string;
  auth_tag_hex: string;
  aad: string;
  rsa_algorithm: string;
  rsa_key_bits: number;
  rsa_key_fingerprint: string;
  wrapped_aes_key_b64: string;
  encrypted_size: number;
  encrypted_at: string;
}

export interface IntegrityVerificationRow {
  id: string;
  evidence_id: string;
  evidence_code?: string;
  original_filename?: string;
  case_code?: string;
  verified_by: string;
  verifier_name?: string;
  verifier_badge?: string;
  expected_sha256: string;
  calculated_sha256: string;
  status: 'INTEGRITY VERIFIED' | 'INTEGRITY MISMATCH' | 'VERIFICATION FAILED';
  details: string;
  verified_at: string;
}

export interface DigitalSignatureRow {
  id: string;
  evidence_id: string;
  evidence_code?: string;
  original_filename?: string;
  case_code?: string;
  signature_status?: string;
  signer_id: string;
  signer_name?: string;
  signer_badge?: string;
  algorithm: string;
  manifest_json: string;
  signature_b64: string;
  public_key_pem?: string;
  key_fingerprint: string;
  signed_at: string;
  last_verified_at: string | null;
  last_verification_result: 'VALID' | 'INVALID' | 'UNAVAILABLE' | null;
}

export interface CustodyEventRow {
  id: number;
  evidence_id: string;
  evidence_code?: string;
  original_filename?: string;
  case_code?: string;
  user_id: string;
  actor_name?: string;
  actor_badge?: string;
  event_type: string;
  timestamp: string;
  description: string;
  previous_event_hash: string;
  current_event_hash: string;
}

export interface AuditLogRow {
  id: number;
  user_id: string | null;
  actor_email: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  status: 'SUCCESS' | 'FAILURE' | 'WARNING';
  ip_address: string;
  details: string;
  created_at: string;
}

export interface LoginAttemptRow {
  id: number;
  email: string;
  user_id: string | null;
  success: number;
  ip_address: string;
  user_agent: string;
  reason: string | null;
  attempted_at: string;
}
