import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderPlus, UserPlus } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiRequest, formatBytes, formatTimestamp } from '../lib/api';
import type { AuditLogRow, CaseRecord, EvidenceRecord } from '../types';

interface AdminDashboardData {
  stats: {
    totalCases: number;
    activeCases: number;
    totalInvestigators: number;
    totalEvidence: number;
    encryptedEvidence: number;
    verifiedEvidence: number;
    pendingVerification: number;
    mismatchEvidence: number;
  };
  recentActivities: AuditLogRow[];
  recentCases: Array<CaseRecord & { assigned_names?: string | null }>;
  recentEvidence: EvidenceRecord[];
}

export function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<AdminDashboardData>('/api/dashboard/admin')
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
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
      title="Administrator Operations Overview"
      breadcrumb="VERITAS / Administration"
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/users"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#252A27] bg-white border border-[#D4D6CE] hover:bg-[#F5F4EF] rounded-[4px] whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Manage Users</span>
          </Link>
          <Link
            to="/cases"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] rounded-[4px] whitespace-nowrap shrink-0"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Investigation Cases</span>
          </Link>
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-6 p-4 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-sm text-[#8E2A2A]">
          {error}
        </div>
      )}

      {/* KPI Grid derived strictly from SQLite */}
      <section aria-label="Database Statistics" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[
          { label: 'Total Cases', value: stats?.totalCases, sub: `${stats?.activeCases ?? 0} active` },
          { label: 'Investigators', value: stats?.totalInvestigators, sub: 'Registered staff' },
          { label: 'Total Evidence', value: stats?.totalEvidence, sub: 'Vault artifacts' },
          { label: 'Encrypted', value: stats?.encryptedEvidence, sub: 'AES-256-GCM' },
          { label: 'Verified Integrity', value: stats?.verifiedEvidence, sub: 'SHA-256 matched' },
          { label: 'Pending Checks', value: stats?.pendingVerification, sub: `${stats?.mismatchEvidence ?? 0} flagged` },
        ].map((metric) => (
          <div key={metric.label} className="bg-white border border-[#E4E5DF] rounded-[4px] p-4">
            <div className="text-[11px] font-semibold text-[#777D77] uppercase tracking-wider">
              {metric.label}
            </div>
            <div className="mt-2 text-2xl font-bold text-[#252A27] tabular-nums">
              {loading ? '—' : (metric.value ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-[#777D77] tabular-nums">{metric.sub}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent Cases & Evidence */}
        <div className="xl:col-span-2 space-y-6">
          <section className="bg-white border border-[#E4E5DF] rounded-[4px]">
            <div className="px-5 py-3.5 border-b border-[#E4E5DF] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#252A27]">Recent Investigation Cases</h2>
              <Link to="/cases" className="text-xs font-medium text-[#536B58] hover:underline">
                View all cases
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E4E5DF] text-[11px] font-semibold text-[#777D77] uppercase">
                    <th className="py-2.5 px-4">Case ID</th>
                    <th className="py-2.5 px-4">Title</th>
                    <th className="py-2.5 px-4">Assigned</th>
                    <th className="py-2.5 px-4">Priority</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Artifacts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E5DF] text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-4 text-center text-[#777D77]">
                        Loading cases...
                      </td>
                    </tr>
                  ) : !data?.recentCases.length ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-4 text-center text-[#777D77]">
                        No investigation cases created yet. Create a case to assign investigators and acquire evidence.
                      </td>
                    </tr>
                  ) : (
                    data.recentCases.map((c) => (
                      <tr key={c.id} className="hover:bg-[#FAF9F6]">
                        <td className="py-2.5 px-4 font-mono font-medium">
                          <Link to={`/cases/${c.id}`} className="text-[#536B58] hover:underline">
                            {c.case_code}
                          </Link>
                        </td>
                        <td className="py-2.5 px-4 font-medium text-[#252A27] max-w-[220px] truncate">
                          {c.title}
                        </td>
                        <td className="py-2.5 px-4 text-[#777D77] max-w-[160px] truncate">
                          {c.assigned_names || 'Unassigned'}
                        </td>
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
              <h2 className="text-sm font-semibold text-[#252A27]">Recent Evidence Acquisitions</h2>
              <Link to="/evidence" className="text-xs font-medium text-[#536B58] hover:underline">
                Open repository
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E4E5DF] text-[11px] font-semibold text-[#777D77] uppercase">
                    <th className="py-2.5 px-4">Evidence ID</th>
                    <th className="py-2.5 px-4">Artifact</th>
                    <th className="py-2.5 px-4">Case</th>
                    <th className="py-2.5 px-4">Encryption</th>
                    <th className="py-2.5 px-4">Integrity</th>
                    <th className="py-2.5 px-4 text-right">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E5DF] text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-4 text-center text-[#777D77]">
                        Loading evidence records...
                      </td>
                    </tr>
                  ) : !data?.recentEvidence.length ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-4 text-center text-[#777D77]">
                        No evidence artifacts acquired yet.
                      </td>
                    </tr>
                  ) : (
                    data.recentEvidence.map((ev) => (
                      <tr key={ev.id} className="hover:bg-[#FAF9F6]">
                        <td className="py-2.5 px-4 font-mono font-medium">
                          <Link to={`/evidence/${ev.id}`} className="text-[#536B58] hover:underline">
                            {ev.evidence_code}
                          </Link>
                        </td>
                        <td className="py-2.5 px-4 max-w-[180px] truncate font-medium">
                          {ev.original_filename}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#777D77]">{ev.case_code}</td>
                        <td className="py-2.5 px-4">
                          <StatusLabel value={ev.encryption_status} />
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusLabel value={ev.integrity_status} />
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

        {/* Recent Security & Audit Activity */}
        <section className="bg-white border border-[#E4E5DF] rounded-[4px] flex flex-col">
          <div className="px-5 py-3.5 border-b border-[#E4E5DF] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#252A27]">Recent Audit Activity</h2>
            <Link to="/audit" className="text-xs font-medium text-[#536B58] hover:underline">
              Full audit log
            </Link>
          </div>
          <div className="divide-y divide-[#E4E5DF] flex-1">
            {loading ? (
              <div className="p-5 text-xs text-[#777D77]">Loading activity stream...</div>
            ) : !data?.recentActivities.length ? (
              <div className="p-5 text-xs text-[#777D77]">No audit events recorded yet.</div>
            ) : (
              data.recentActivities.map((act) => (
                <div key={act.id} className="p-4 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#252A27] truncate">
                      {act.action}
                    </span>
                    <StatusLabel value={act.status} />
                  </div>
                  <p className="mt-1 text-[#4A504C] leading-relaxed">{act.details}</p>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#777D77] font-mono">
                    <span className="truncate">{act.actor_email}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">{formatTimestamp(act.created_at)}</span>
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
