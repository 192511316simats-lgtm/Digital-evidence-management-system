import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitCommitHorizontal, ShieldCheck } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiRequest, formatTimestamp } from '../lib/api';
import type { CustodyEventRow, EvidenceRecord } from '../types';

interface CustodyValidationReport {
  evidenceId: string;
  evidenceCode: string;
  validation: {
    valid: boolean;
    totalEvents: number;
    brokenAtEventId: number | null;
    reason: string | null;
  };
}

export function ChainOfCustodyPage() {
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [events, setEvents] = useState<CustodyEventRow[]>([]);
  const [validationReport, setValidationReport] = useState<CustodyValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCustody = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = selectedEvidenceId ? `?evidenceId=${encodeURIComponent(selectedEvidenceId)}` : '';
      const [evRes, custRes] = await Promise.all([
        apiRequest<{ evidence: EvidenceRecord[] }>('/api/evidence'),
        apiRequest<{ events: CustodyEventRow[] }>(`/api/custody${qs}`),
      ]);
      setEvidenceList(evRes.evidence);
      setEvents(custRes.events);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load chain of custody records.');
    } finally {
      setLoading(false);
    }
  }, [selectedEvidenceId]);

  useEffect(() => {
    void loadCustody();
  }, [loadCustody]);

  const validateChain = async () => {
    const targetId = selectedEvidenceId || evidenceList[0]?.id;
    if (!targetId) return;
    setValidating(true);
    setError(null);
    try {
      const res = await apiRequest<CustodyValidationReport>(`/api/custody/${targetId}/validate`);
      setValidationReport(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to validate custody chain.');
    } finally {
      setValidating(false);
    }
  };

  return (
    <AppShell title="Chain of Custody" breadcrumb="VERITAS / Hash-Linked Activity Ledger">
      {error && (
        <div role="alert" className="mb-5 p-4 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
          {error}
        </div>
      )}

      <div className="bg-white border border-[#E4E5DF] rounded-[4px] p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
          <GitCommitHorizontal className="w-4 h-4 text-[#536B58] shrink-0" />
          <select
            aria-label="Filter custody timeline by evidence"
            value={selectedEvidenceId}
            onChange={(e) => {
              setSelectedEvidenceId(e.target.value);
              setValidationReport(null);
            }}
            className="flex-1 max-w-md px-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px]"
          >
            <option value="">All Authorized Evidence Events</option>
            {evidenceList.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.evidence_code} — {ev.original_filename} ({ev.case_code})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={validating || evidenceList.length === 0}
          onClick={validateChain}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-50 rounded-[4px] cursor-pointer whitespace-nowrap"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{validating ? 'Validating Hash Links...' : 'Validate Hash Chain'}</span>
        </button>
      </div>

      {validationReport && (
        <div
          className={`mb-6 p-4 border rounded-[4px] text-xs flex flex-wrap items-center justify-between gap-3 ${
            validationReport.validation.valid
              ? 'bg-[#EDF3EE] border-[#B8CEBD] text-[#2F5237]'
              : 'bg-[#FDF1F1] border-[#E9BEBE] text-[#8E2A2A]'
          }`}
        >
          <div>
            <span className="font-mono font-semibold">{validationReport.evidenceCode}</span>:{' '}
            {validationReport.validation.valid
              ? `All ${validationReport.validation.totalEvents} hash-linked custody records verified cleanly from genesis digest.`
              : validationReport.validation.reason}
          </div>
          <StatusLabel
            value={validationReport.validation.valid ? 'VALID' : 'INVALID'}
            tone={validationReport.validation.valid ? 'verified' : 'danger'}
          />
        </div>
      )}

      <div className="bg-white border border-[#E4E5DF] rounded-[4px] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E4E5DF] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#252A27]">Custody Event Timeline</h2>
          <span className="text-[11px] text-[#777D77]">
            Hash-linked SHA-256 chain enables detection of post-hoc record alteration
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                <th className="py-2.5 px-4">ID</th>
                <th className="py-2.5 px-4">Evidence / Case</th>
                <th className="py-2.5 px-4">Event Type</th>
                <th className="py-2.5 px-4">Actor</th>
                <th className="py-2.5 px-4">Description</th>
                <th className="py-2.5 px-4">Hash Chain (Prev / Curr)</th>
                <th className="py-2.5 px-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E5DF] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-[#777D77]">
                    Loading chain of custody events...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-[#777D77]">
                    No custody events found. Acquire an evidence file to initiate its custody chain.
                  </td>
                </tr>
              ) : (
                events.map((ce) => (
                  <tr key={ce.id} className="hover:bg-[#FAF9F6]">
                    <td className="py-2.5 px-4 font-mono text-[#777D77] tabular-nums">{ce.id}</td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <Link to={`/evidence/${ce.evidence_id}`} className="font-mono font-semibold text-[#536B58] hover:underline">
                        {ce.evidence_code}
                      </Link>
                      <div className="font-mono text-[11px] text-[#777D77]">{ce.case_code}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusLabel value={ce.event_type} />
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {ce.actor_name} <span className="font-mono text-[11px] text-[#777D77]">({ce.actor_badge})</span>
                    </td>
                    <td className="py-2.5 px-4 text-[#4A504C] max-w-[300px]">{ce.description}</td>
                    <td className="py-2.5 px-4 font-mono text-[10px] text-[#777D77]">
                      <div>P: {ce.previous_event_hash.slice(0, 14)}...</div>
                      <div className="text-[#252A27]">C: {ce.current_event_hash.slice(0, 14)}...</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                      {formatTimestamp(ce.timestamp)}
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
