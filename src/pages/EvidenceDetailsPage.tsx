import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Download,
  FileCheck2,
  FileSpreadsheet,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiDownload, apiRequest, formatBytes, formatTimestamp } from '../lib/api';
import type {
  CustodyEventRow,
  DigitalSignatureRow,
  EncryptionMetadata,
  EvidenceRecord,
  IntegrityVerificationRow,
} from '../types';

interface EvidenceDetailsPayload {
  evidence: EvidenceRecord;
  encryptionMetadata: EncryptionMetadata | null;
  integrityHistory: IntegrityVerificationRow[];
  signatures: DigitalSignatureRow[];
  custodyEvents: CustodyEventRow[];
  custodyValidation: {
    valid: boolean;
    totalEvents: number;
    brokenAtEventId: number | null;
    reason: string | null;
  };
}

export function EvidenceDetailsPage() {
  const { evidenceId } = useParams<{ evidenceId: string }>();
  const [data, setData] = useState<EvidenceDetailsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    if (!evidenceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<EvidenceDetailsPayload>(`/api/evidence/${evidenceId}`);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load evidence details.');
    } finally {
      setLoading(false);
    }
  }, [evidenceId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const runIntegrityCheck = async () => {
    if (!data) return;
    setBusyAction('integrity');
    setError(null);
    setFeedback(null);
    try {
      const res = await apiRequest<{ verification: IntegrityVerificationRow }>(
        `/api/evidence/${data.evidence.id}/verify-integrity`,
        { method: 'POST' }
      );
      setFeedback(`Integrity Verification Result: ${res.verification.status}`);
      await loadDetails();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Integrity verification failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const signEvidenceManifest = async () => {
    if (!data) return;
    setBusyAction('sign');
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/api/evidence/${data.evidence.id}/sign`, { method: 'POST' });
      setFeedback('Canonical evidence manifest signed with RSA-PSS-SHA256.');
      await loadDetails();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign evidence manifest.');
    } finally {
      setBusyAction(null);
    }
  };

  const verifyEvidenceSignature = async () => {
    if (!data) return;
    setBusyAction('verify-sig');
    setError(null);
    setFeedback(null);
    try {
      const res = await apiRequest<{ result: string; reason?: string }>(
        `/api/evidence/${data.evidence.id}/verify-signature`,
        { method: 'POST' }
      );
      setFeedback(
        res.reason ? `Signature Status: ${res.result} — ${res.reason}` : `Signature Verification Result: ${res.result}`
      );
      await loadDetails();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to verify digital signature.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDecryptDownload = async () => {
    if (!data) return;
    setBusyAction('decrypt');
    setError(null);
    try {
      await apiDownload(`/api/evidence/${data.evidence.id}/decrypt`, data.evidence.original_filename);
      setFeedback('Authorized AES-256-GCM decryption & download completed and logged.');
      await loadDetails();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authorized decryption failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadPdf = async () => {
    if (!data) return;
    setBusyAction('pdf');
    setError(null);
    try {
      await apiDownload(
        `/api/reports/${data.evidence.id}/pdf`,
        `VERITAS_Report_${data.evidence.evidence_code}.pdf`
      );
      setFeedback('Forensic PDF report generated from database records.');
      await loadDetails();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Report generation failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const ev = data?.evidence;
  const enc = data?.encryptionMetadata;
  const latestInt = data?.integrityHistory?.[0] || null;
  const latestSig = data?.signatures?.[0] || null;

  return (
    <AppShell
      title={ev ? `${ev.evidence_code} — ${ev.original_filename}` : 'Evidence Details'}
      breadcrumb="VERITAS / Evidence Repository / Artifact Dossier"
      actions={
        ev ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDecryptDownload}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#252A27] bg-white border border-[#D4D6CE] hover:bg-[#F5F4EF] rounded-[4px] whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Decrypt & Download</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] rounded-[4px] whitespace-nowrap cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export PDF Report</span>
            </button>
          </div>
        ) : undefined
      }
    >
      {error && (
        <div role="alert" className="mb-5 p-4 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
          {error}
        </div>
      )}
      {feedback && (
        <div className="mb-5 p-4 bg-[#EDF3EE] border border-[#B8CEBD] rounded-[4px] text-xs text-[#2F5237]">
          {feedback}
        </div>
      )}

      {loading || !ev ? (
        <div className="bg-white border border-[#E4E5DF] rounded-[4px] p-8 text-xs text-[#777D77]">
          {loading ? 'Loading evidence dossier...' : 'Evidence record unavailable.'}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Artifact Overview & Action Controls */}
          <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 mb-4 border-b border-[#E4E5DF]">
              <div>
                <div className="font-mono text-xs text-[#777D77]">
                  <Link to={`/cases/${ev.case_id}`} className="text-[#536B58] hover:underline">
                    {ev.case_code}
                  </Link>{' '}
                  · {ev.case_title}
                </div>
                <h2 className="mt-1 text-base font-semibold text-[#252A27]">{ev.original_filename}</h2>
                <div className="mt-1 text-xs text-[#777D77] font-mono">
                  {ev.mime_type} · {formatBytes(ev.file_size)} · Acquired by {ev.uploader_name} ({ev.uploader_badge}) on{' '}
                  {formatTimestamp(ev.uploaded_at)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusLabel value={ev.encryption_status} />
                <StatusLabel value={ev.integrity_status} />
                <StatusLabel value={ev.signature_status} />
              </div>
            </div>

            <div className="mb-4">
              <div className="text-[11px] font-semibold text-[#777D77] uppercase mb-1">
                Expected Acquisition SHA-256 Digest
              </div>
              <div className="p-2.5 bg-[#FAF9F6] border border-[#E4E5DF] rounded-[4px] font-mono text-xs break-all text-[#252A27]">
                {ev.sha256_hash}
              </div>
            </div>

            {ev.notes && (
              <div className="mb-4 text-xs text-[#4A504C]">
                <span className="font-semibold text-[#252A27]">Acquisition Notes: </span>
                {ev.notes}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#E4E5DF]">
              <button
                type="button"
                onClick={runIntegrityCheck}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-50 rounded-[4px] cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{busyAction === 'integrity' ? 'Verifying SHA-256...' : 'Verify SHA-256 Integrity'}</span>
              </button>

              <button
                type="button"
                onClick={signEvidenceManifest}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#202522] hover:bg-[#323A35] disabled:opacity-50 rounded-[4px] cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{busyAction === 'sign' ? 'Signing...' : 'Sign Manifest (RSA-PSS)'}</span>
              </button>

              <button
                type="button"
                onClick={verifyEvidenceSignature}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#252A27] bg-white border border-[#D4D6CE] hover:bg-[#F5F4EF] disabled:opacity-50 rounded-[4px] cursor-pointer"
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>{busyAction === 'verify-sig' ? 'Verifying Signature...' : 'Verify Digital Signature'}</span>
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Hybrid Cryptography Metadata */}
            <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5">
              <h3 className="text-sm font-semibold text-[#252A27] pb-3 border-b border-[#E4E5DF]">
                Hybrid Cryptography Metadata
              </h3>
              {enc ? (
                <dl className="mt-3 space-y-2.5 text-xs">
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#777D77]">Symmetric Cipher</dt>
                    <dd className="font-mono font-medium">{enc.aes_algorithm}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#777D77]">Key Wrapping</dt>
                    <dd className="font-mono font-medium">
                      {enc.rsa_algorithm} ({enc.rsa_key_bits}-bit)
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#777D77] mb-0.5">Vault Key Fingerprint</dt>
                    <dd className="font-mono text-[11px] text-[#252A27] break-all">{enc.rsa_key_fingerprint}</dd>
                  </div>
                  <div>
                    <dt className="text-[#777D77] mb-0.5">Nonce / IV (Hex)</dt>
                    <dd className="font-mono text-[11px] text-[#4A504C] break-all">{enc.iv_hex}</dd>
                  </div>
                  <div>
                    <dt className="text-[#777D77] mb-0.5">GCM Authentication Tag (Hex)</dt>
                    <dd className="font-mono text-[11px] text-[#4A504C] break-all">{enc.auth_tag_hex}</dd>
                  </div>
                  <div>
                    <dt className="text-[#777D77] mb-0.5">RSA-OAEP Wrapped AES-256 Key (Base64 Excerpt)</dt>
                    <dd className="font-mono text-[11px] text-[#4A504C] break-all">
                      {enc.wrapped_aes_key_b64.slice(0, 96)}...
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-xs text-[#777D77]">No encryption metadata stored.</p>
              )}
            </section>

            {/* Latest Verification & Signature Summary */}
            <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5 space-y-5">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-[#E4E5DF]">
                  <h3 className="text-sm font-semibold text-[#252A27]">Latest Integrity Verification</h3>
                  <StatusLabel value={latestInt ? latestInt.status : 'PENDING'} />
                </div>
                {latestInt ? (
                  <dl className="mt-3 space-y-2 text-xs">
                    <div>
                      <dt className="text-[#777D77]">Calculated SHA-256</dt>
                      <dd className="font-mono text-[11px] break-all text-[#252A27]">{latestInt.calculated_sha256}</dd>
                    </div>
                    <div className="text-[#4A504C]">{latestInt.details}</div>
                    <div className="font-mono text-[11px] text-[#777D77]">
                      Verified by {latestInt.verifier_name} ({latestInt.verifier_badge}) · {formatTimestamp(latestInt.verified_at)}
                    </div>
                  </dl>
                ) : (
                  <p className="mt-3 text-xs text-[#777D77]">
                    No SHA-256 integrity check has been run yet. Click &quot;Verify SHA-256 Integrity&quot; above.
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between pb-2 border-b border-[#E4E5DF]">
                  <h3 className="text-sm font-semibold text-[#252A27]">Digital Signature (RSA-PSS)</h3>
                  <StatusLabel value={ev.signature_status} />
                </div>
                {latestSig ? (
                  <dl className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-[#777D77]">Signer</dt>
                      <dd className="font-medium">
                        {latestSig.signer_name} ({latestSig.signer_badge})
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#777D77]">Signing Key Fingerprint</dt>
                      <dd className="font-mono text-[11px]">{latestSig.key_fingerprint}</dd>
                    </div>
                    <div>
                      <dt className="text-[#777D77]">Signature Digest (Base64 Excerpt)</dt>
                      <dd className="font-mono text-[11px] break-all text-[#4A504C]">
                        {latestSig.signature_b64.slice(0, 88)}...
                      </dd>
                    </div>
                    <div className="font-mono text-[11px] text-[#777D77]">
                      Signed {formatTimestamp(latestSig.signed_at)}
                      {latestSig.last_verified_at ? ` · Verified ${formatTimestamp(latestSig.last_verified_at)}` : ''}
                    </div>
                  </dl>
                ) : (
                  <p className="mt-3 text-xs text-[#777D77]">
                    Manifest not yet signed. Click &quot;Sign Manifest (RSA-PSS)&quot; above.
                  </p>
                )}
              </div>
            </section>
          </div>

          {/* Hash-Linked Chain of Custody */}
          <section className="bg-white border border-[#E4E5DF] rounded-[4px]">
            <div className="px-5 py-3.5 border-b border-[#E4E5DF] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[#252A27]">
                  Hash-Linked Chain of Custody ({data.custodyValidation.totalEvents} events)
                </h3>
                <p className="text-[11px] text-[#777D77]">
                  Each event hashes the previous event digest to detect post-hoc record modification.
                </p>
              </div>
              <StatusLabel
                value={data.custodyValidation.valid ? 'VALID' : 'INVALID'}
                tone={data.custodyValidation.valid ? 'verified' : 'danger'}
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                    <th className="py-2.5 px-4">#</th>
                    <th className="py-2.5 px-4">Event</th>
                    <th className="py-2.5 px-4">Actor</th>
                    <th className="py-2.5 px-4">Description</th>
                    <th className="py-2.5 px-4">Event Hash Link</th>
                    <th className="py-2.5 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E5DF] text-xs">
                  {data.custodyEvents.map((ce) => (
                    <tr key={ce.id} className="hover:bg-[#FAF9F6]">
                      <td className="py-2.5 px-4 font-mono text-[#777D77] tabular-nums">{ce.id}</td>
                      <td className="py-2.5 px-4">
                        <StatusLabel value={ce.event_type} />
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span className="font-medium">{ce.actor_name}</span>{' '}
                        <span className="font-mono text-[11px] text-[#777D77]">({ce.actor_badge})</span>
                      </td>
                      <td className="py-2.5 px-4 text-[#4A504C] max-w-[340px]">{ce.description}</td>
                      <td className="py-2.5 px-4 font-mono text-[10px] text-[#777D77]">
                        <div>PREV: {ce.previous_event_hash.slice(0, 14)}...</div>
                        <div className="text-[#252A27]">CURR: {ce.current_event_hash.slice(0, 14)}...</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                        {formatTimestamp(ce.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
