import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCheck2, KeyRound } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiRequest, formatTimestamp } from '../lib/api';
import type { DigitalSignatureRow, EvidenceRecord } from '../types';

export function DigitalSignaturesPage() {
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [signatures, setSignatures] = useState<DigitalSignatureRow[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evRes, sigRes] = await Promise.all([
        apiRequest<{ evidence: EvidenceRecord[] }>('/api/evidence'),
        apiRequest<{ signatures: DigitalSignatureRow[] }>('/api/signatures/list'),
      ]);
      setEvidenceList(evRes.evidence);
      setSignatures(sigRes.signatures);
      if (!selectedEvidenceId && evRes.evidence.length > 0) {
        setSelectedEvidenceId(evRes.evidence[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load digital signature records.');
    } finally {
      setLoading(false);
    }
  }, [selectedEvidenceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSign = async () => {
    if (!selectedEvidenceId) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/api/evidence/${selectedEvidenceId}/sign`, { method: 'POST' });
      setFeedback('Canonical evidence manifest signed with RSA-PSS-SHA256.');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Manifest signing failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (targetEvidenceId: string) => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await apiRequest<{ result: string; reason?: string }>(
        `/api/evidence/${targetEvidenceId}/verify-signature`,
        { method: 'POST' }
      );
      setFeedback(
        res.reason ? `Verification Result: ${res.result} — ${res.reason}` : `Signature Verification Result: ${res.result}`
      );
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signature verification failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Digital Signatures (RSA-PSS)" breadcrumb="VERITAS / Cryptographic Authenticity">
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

      <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <label htmlFor="sig-ev-select" className="block text-xs font-semibold text-[#252A27] mb-1.5">
              Select Evidence Manifest to Sign or Verify
            </label>
            <select
              id="sig-ev-select"
              value={selectedEvidenceId}
              onChange={(e) => setSelectedEvidenceId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#D4D6CE] rounded-[4px]"
            >
              <option value="">Select evidence artifact...</option>
              {evidenceList.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.evidence_code} — {ev.original_filename} ({ev.signature_status})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!selectedEvidenceId || busy}
              onClick={handleSign}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#202522] hover:bg-[#323A35] disabled:opacity-50 rounded-[4px] cursor-pointer whitespace-nowrap"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Sign Manifest (RSA-PSS)</span>
            </button>
            <button
              type="button"
              disabled={!selectedEvidenceId || busy}
              onClick={() => handleVerify(selectedEvidenceId)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-50 rounded-[4px] cursor-pointer whitespace-nowrap"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>Verify Signature</span>
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white border border-[#E4E5DF] rounded-[4px] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E4E5DF]">
          <h2 className="text-sm font-semibold text-[#252A27]">Registered RSA-PSS Digital Signatures</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                <th className="py-2.5 px-4">Evidence</th>
                <th className="py-2.5 px-4">Algorithm & Key FP</th>
                <th className="py-2.5 px-4">Signer</th>
                <th className="py-2.5 px-4">Signature Digest</th>
                <th className="py-2.5 px-4">Verification</th>
                <th className="py-2.5 px-4">Signed At</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E5DF] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-[#777D77]">
                    Loading digital signatures...
                  </td>
                </tr>
              ) : signatures.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-[#777D77]">
                    No evidence manifests have been signed yet. Select an evidence artifact above to sign its canonical manifest.
                  </td>
                </tr>
              ) : (
                signatures.map((sig) => (
                  <tr key={sig.id} className="hover:bg-[#FAF9F6]">
                    <td className="py-2.5 px-4">
                      <Link to={`/evidence/${sig.evidence_id}`} className="font-mono font-semibold text-[#536B58] hover:underline">
                        {sig.evidence_code}
                      </Link>
                      <div className="text-[11px] text-[#777D77] truncate max-w-[160px]">{sig.original_filename}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px]">
                      <div>{sig.algorithm}</div>
                      <div className="text-[#777D77]">{sig.key_fingerprint.slice(0, 16)}...</div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {sig.signer_name} <span className="font-mono text-[11px] text-[#777D77]">({sig.signer_badge})</span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[#4A504C]">
                      {sig.signature_b64.slice(0, 24)}...
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusLabel value={sig.last_verification_result || 'UNAVAILABLE'} />
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                      {formatTimestamp(sig.signed_at)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleVerify(sig.evidence_id)}
                        className="px-2.5 py-1 text-[11px] font-semibold text-[#252A27] bg-white border border-[#D4D6CE] hover:bg-[#F5F4EF] rounded-[3px] cursor-pointer"
                      >
                        Re-verify
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
