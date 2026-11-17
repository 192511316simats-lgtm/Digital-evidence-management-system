import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiRequest, formatTimestamp } from '../lib/api';
import type { EvidenceRecord, IntegrityVerificationRow } from '../types';

export function IntegrityVerificationPage() {
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [history, setHistory] = useState<IntegrityVerificationRow[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [latestResult, setLatestResult] = useState<IntegrityVerificationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evRes, histRes] = await Promise.all([
        apiRequest<{ evidence: EvidenceRecord[] }>('/api/evidence'),
        apiRequest<{ history: IntegrityVerificationRow[] }>('/api/integrity/history'),
      ]);
      setEvidenceList(evRes.evidence);
      setHistory(histRes.history);
      if (!selectedEvidenceId && evRes.evidence.length > 0) {
        setSelectedEvidenceId(evRes.evidence[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load integrity verification records.');
    } finally {
      setLoading(false);
    }
  }, [selectedEvidenceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvidenceId) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await apiRequest<{ verification: IntegrityVerificationRow }>(
        `/api/evidence/${selectedEvidenceId}/verify-integrity`,
        { method: 'POST' }
      );
      setLatestResult(res.verification);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Integrity verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <AppShell title="SHA-256 Integrity Verification" breadcrumb="VERITAS / Cryptographic Integrity">
      {error && (
        <div role="alert" className="mb-5 p-4 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5">
          <h2 className="text-sm font-semibold text-[#252A27] pb-3 border-b border-[#E4E5DF]">
            Execute Live Hash Verification
          </h2>
          <p className="mt-2 text-xs text-[#777D77] leading-relaxed">
            Unwraps the AES-256-GCM key via RSA-OAEP, decrypts the vault artifact in memory, computes its live SHA-256 digest, and compares against the acquisition hash.
          </p>

          <form onSubmit={handleVerify} className="mt-4 space-y-4">
            <div>
              <label htmlFor="int-ev-select" className="block text-xs font-semibold text-[#252A27] mb-1">
                Evidence Artifact
              </label>
              <select
                id="int-ev-select"
                value={selectedEvidenceId}
                onChange={(e) => setSelectedEvidenceId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#D4D6CE] rounded-[4px]"
              >
                <option value="">Select evidence artifact...</option>
                {evidenceList.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.evidence_code} — {ev.original_filename} ({ev.case_code})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={!selectedEvidenceId || verifying}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-50 rounded-[4px] cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{verifying ? 'Recalculating SHA-256...' : 'Verify Evidence Integrity'}</span>
            </button>
          </form>
        </section>

        <section className="lg:col-span-2 bg-white border border-[#E4E5DF] rounded-[4px] p-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#E4E5DF]">
            <h2 className="text-sm font-semibold text-[#252A27]">Hash Comparison Output</h2>
            {latestResult && <StatusLabel value={latestResult.status} />}
          </div>

          {latestResult ? (
            <div className="mt-4 space-y-3 text-xs">
              <div>
                <div className="text-[11px] font-semibold text-[#777D77] uppercase mb-1">
                  Expected SHA-256 (Stored at Acquisition)
                </div>
                <div className="p-2.5 bg-[#FAF9F6] border border-[#E4E5DF] rounded-[4px] font-mono text-[11px] break-all">
                  {latestResult.expected_sha256}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-[#777D77] uppercase mb-1">
                  Calculated SHA-256 (Live Decrypted Payload)
                </div>
                <div className="p-2.5 bg-[#FAF9F6] border border-[#E4E5DF] rounded-[4px] font-mono text-[11px] break-all">
                  {latestResult.calculated_sha256}
                </div>
              </div>
              <div className="pt-1 text-[#4A504C]">{latestResult.details}</div>
              <div className="font-mono text-[11px] text-[#777D77]">
                Verified by {latestResult.verifier_name} ({latestResult.verifier_badge}) ·{' '}
                {formatTimestamp(latestResult.verified_at)}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-[#777D77]">
              Select an evidence item and run verification to inspect live SHA-256 hash comparison.
            </div>
          )}
        </section>
      </div>

      {/* Verification History */}
      <section className="bg-white border border-[#E4E5DF] rounded-[4px] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E4E5DF]">
          <h2 className="text-sm font-semibold text-[#252A27]">Integrity Verification Ledger</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                <th className="py-2.5 px-4">Evidence</th>
                <th className="py-2.5 px-4">Case</th>
                <th className="py-2.5 px-4">Expected vs Calculated</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Investigator</th>
                <th className="py-2.5 px-4">Verified At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E5DF] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-[#777D77]">
                    Loading verification history...
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-[#777D77]">
                    No integrity verification runs recorded yet.
                  </td>
                </tr>
              ) : (
                history.map((row) => (
                  <tr key={row.id} className="hover:bg-[#FAF9F6]">
                    <td className="py-2.5 px-4">
                      <Link to={`/evidence/${row.evidence_id}`} className="font-mono font-semibold text-[#536B58] hover:underline">
                        {row.evidence_code}
                      </Link>
                      <div className="text-[11px] text-[#777D77] truncate max-w-[180px]">{row.original_filename}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[#777D77]">{row.case_code}</td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[#4A504C]">
                      <div>EXP: {row.expected_sha256.slice(0, 16)}...</div>
                      <div>CAL: {row.calculated_sha256.slice(0, 16)}...</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusLabel value={row.status} />
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {row.verifier_name} <span className="font-mono text-[11px] text-[#777D77]">({row.verifier_badge})</span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                      {formatTimestamp(row.verified_at)}
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
