import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, Search } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiRequest, formatBytes, formatTimestamp } from '../lib/api';
import type { EvidenceRecord } from '../types';

export function EvidenceRepositoryPage() {
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [integrityFilter, setIntegrityFilter] = useState('');

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (integrityFilter) params.set('integrity', integrityFilter);
      const res = await apiRequest<{ evidence: EvidenceRecord[] }>(`/api/evidence?${params.toString()}`);
      setEvidence(res.evidence);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load evidence repository.');
    } finally {
      setLoading(false);
    }
  }, [search, integrityFilter]);

  useEffect(() => {
    void loadEvidence();
  }, [loadEvidence]);

  return (
    <AppShell
      title="Evidence Repository"
      breadcrumb="VERITAS / Encrypted Vault"
      actions={
        <Link
          to="/evidence/acquire"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] rounded-[4px] whitespace-nowrap shrink-0"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          <span>Acquire Evidence</span>
        </Link>
      }
    >
      <div className="bg-white border border-[#E4E5DF] rounded-[4px] p-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-[#777D77] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            aria-label="Search evidence"
            placeholder="Search by evidence ID, filename, SHA-256 hash, or case ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
          />
        </div>

        <select
          aria-label="Filter by integrity status"
          value={integrityFilter}
          onChange={(e) => setIntegrityFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
        >
          <option value="">All Integrity States</option>
          <option value="PENDING">PENDING</option>
          <option value="INTEGRITY VERIFIED">INTEGRITY VERIFIED</option>
          <option value="INTEGRITY MISMATCH">INTEGRITY MISMATCH</option>
          <option value="VERIFICATION FAILED">VERIFICATION FAILED</option>
        </select>
      </div>

      {error && (
        <div role="alert" className="mb-5 p-4 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
          {error}
        </div>
      )}

      <div className="bg-white border border-[#E4E5DF] rounded-[4px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                <th className="py-3 px-4">Evidence ID</th>
                <th className="py-3 px-4">Filename</th>
                <th className="py-3 px-4">Case</th>
                <th className="py-3 px-4">SHA-256 Digest</th>
                <th className="py-3 px-4">Encryption</th>
                <th className="py-3 px-4">Integrity</th>
                <th className="py-3 px-4">Signature</th>
                <th className="py-3 px-4 text-right">Size</th>
                <th className="py-3 px-4">Acquired</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E5DF] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-8 px-4 text-center text-[#777D77]">
                    Loading encrypted evidence repository...
                  </td>
                </tr>
              ) : evidence.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 px-4 text-center text-[#777D77]">
                    No evidence records found. Acquire an evidence artifact to populate the vault.
                  </td>
                </tr>
              ) : (
                evidence.map((ev) => (
                  <tr key={ev.id} className="hover:bg-[#FAF9F6]">
                    <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                      <Link to={`/evidence/${ev.id}`} className="text-[#536B58] hover:underline">
                        {ev.evidence_code}
                      </Link>
                    </td>
                    <td className="py-3 px-4 font-medium max-w-[180px] truncate">
                      <Link to={`/evidence/${ev.id}`} className="hover:underline">
                        {ev.original_filename}
                      </Link>
                    </td>
                    <td className="py-3 px-4 font-mono text-[#4A504C] whitespace-nowrap">
                      <Link to={`/cases/${ev.case_id}`} className="hover:underline">
                        {ev.case_code}
                      </Link>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#777D77]">
                      {ev.sha256_hash.slice(0, 16)}...
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel value={ev.encryption_status} />
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel value={ev.integrity_status} />
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel value={ev.signature_status} />
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-[#777D77] whitespace-nowrap">
                      {formatBytes(ev.file_size)}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                      {formatTimestamp(ev.uploaded_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
