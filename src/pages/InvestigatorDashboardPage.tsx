import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2 } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiRequest, formatBytes, formatTimestamp } from '../lib/api';
import type { CaseRecord, EvidenceRecord } from '../types';

interface InvestigatorDashboardData {
  stats: {
    assignedCasesCount: number;
    evidenceUploadedCount: number;
    pendingVerificationCount: number;
    authorizedEvidenceCount: number;
  };
  assignedCases: CaseRecord[];
  authorizedEvidence: EvidenceRecord[];
  recentActivity: Array<{
    id: number;
    event_type: string;
    timestamp: string;
    description: string;
    evidence_code: string;
    actor_name: string;
  }>;
}

export function InvestigatorDashboardPage() {
  const [data, setData] = useState<InvestigatorDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<InvestigatorDashboardData>('/api/dashboard/investigator')
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load investigator dashboard.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const stats = data?.stats;

  return (
    <AppShell
      title="Investigator Workspace"
      breadcrumb="VERITAS / Investigator Operations"
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
      {error && (
        <div role="alert" className="mb-6 p-4 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-sm text-[#8E2A2A]">
          {error}
        </div>
      )}

      <section aria-label="Investigator Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Assigned Cases', value: stats?.assignedCasesCount, sub: 'Active caseload' },
          { label: 'Evidence Uploaded', value: stats?.evidenceUploadedCount, sub: 'Acquired by you' },
          { label: 'Authorized Artifacts', value: stats?.authorizedEvidenceCount, sub: 'Accessible evidence' },
          { label: 'Pending Verification', value: stats?.pendingVerificationCount, sub: 'Requires SHA-256 check' },
        ].map((m) => (
          <div key={m.label} className="bg-white border border-[#E4E5DF] rounded-[4px] p-4">
            <div className="text-[11px] font-semibold text-[#777D77] uppercase tracking-wider">{m.label}</div>
            <div className="mt-2 text-2xl font-bold text-[#252A27] tabular-nums">
              {loading ? '—' : (m.value ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-[#777D77]">{m.sub}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <section className="bg-white border border-[#E4E5DF] rounded-[4px]">
            <div className="px-5 py-3.5 border-b border-[#E4E5DF] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#252A27]">Assigned Investigation Cases</h2>
              <Link to="/cases" className="text-xs font-medium text-[#536B58] hover:underline">
                View cases
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E4E5DF] text-[11px] font-semibold text-[#777D77] uppercase">
                    <th className="py-2.5 px-4">Case ID</th>
                    <th className="py-2.5 px-4">Title</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4">Priority</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E5DF] text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-4 text-center text-[#777D77]">
                        Loading assigned cases...
                      </td>
                    </tr>
                  ) : !data?.assignedCases.length ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-4 text-center text-[#777D77]">
                        No investigation cases are currently assigned to your account. An administrator must assign you to a case before acquiring evidence.
                      </td>
                    </tr>
                  ) : (
                    data.assignedCases.map((c) => (
                      <tr key={c.id} className="hover:bg-[#FAF9F6]">
                        <td className="py-2.5 px-4 font-mono font-medium">
                          <Link to={`/cases/${c.id}`} className="text-[#536B58] hover:underline">
                            {c.case_code}
                          </Link>
                        </td>
                        <td className="py-2.5 px-4 font-medium max-w-[220px] truncate">{c.title}</td>
                        <td className="py-2.5 px-4 text-[#777D77]">{c.category}</td>
                        <td className="py-2.5 px-4">
                          <StatusLabel value={c.priority} />
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusLabel value={c.status} />
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {c.evidence_count ?? 0}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white border border-[#E4E5DF] rounded-[4px]">
            <div className="px-5 py-3.5 border-b border-[#E4E5DF] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#252A27]">Authorized Evidence Artifacts</h2>
              <Link to="/evidence" className="text-xs font-medium text-[#536B58] hover:underline">
                View repository
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E4E5DF] text-[11px] font-semibold text-[#777D77] uppercase">
                    <th className="py-2.5 px-4">Evidence ID</th>
                    <th className="py-2.5 px-4">Filename</th>
                    <th className="py-2.5 px-4">Case</th>
                    <th className="py-2.5 px-4">Integrity</th>
                    <th className="py-2.5 px-4">Signature</th>
                    <th className="py-2.5 px-4 text-right">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E5DF] text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-4 text-center text-[#777D77]">
                        Loading authorized evidence...
                      </td>
                    </tr>
                  ) : !data?.authorizedEvidence.length ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-4 text-center text-[#777D77]">
                        No evidence artifacts found for your assigned cases.
                      </td>
                    </tr>
                  ) : (
                    data.authorizedEvidence.map((ev) => (
                      <tr key={ev.id} className="hover:bg-[#FAF9F6]">
                        <td className="py-2.5 px-4 font-mono font-medium">
                          <Link to={`/evidence/${ev.id}`} className="text-[#536B58] hover:underline">
                            {ev.evidence_code}
                          </Link>
                        </td>
                        <td className="py-2.5 px-4 font-medium max-w-[180px] truncate">{ev.original_filename}</td>
                        <td className="py-2.5 px-4 font-mono text-[#777D77]">{ev.case_code}</td>
                        <td className="py-2.5 px-4">
                          <StatusLabel value={ev.integrity_status} />
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusLabel value={ev.signature_status} />
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#777D77]">
                          {formatBytes(ev.file_size)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="bg-white border border-[#E4E5DF] rounded-[4px]">
          <div className="px-5 py-3.5 border-b border-[#E4E5DF] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#252A27]">Recent Custody Events</h2>
            <Link to="/custody" className="text-xs font-medium text-[#536B58] hover:underline">
              Chain of custody
            </Link>
          </div>
          <div className="divide-y divide-[#E4E5DF]">
            {loading ? (
              <div className="p-5 text-xs text-[#777D77]">Loading events...</div>
            ) : !data?.recentActivity.length ? (
              <div className="p-5 text-xs text-[#777D77]">No custody activity on your assigned cases yet.</div>
            ) : (
              data.recentActivity.map((ev) => (
                <div key={ev.id} className="p-4 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#536B58]">{ev.evidence_code}</span>
                    <StatusLabel value={ev.event_type} />
                  </div>
                  <p className="mt-1 text-[#252A27] leading-relaxed">{ev.description}</p>
                  <div className="mt-1.5 text-[11px] text-[#777D77] font-mono">
                    {ev.actor_name} · {formatTimestamp(ev.timestamp)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
