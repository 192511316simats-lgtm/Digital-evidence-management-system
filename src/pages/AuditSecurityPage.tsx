import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiRequest, formatTimestamp } from '../lib/api';
import type { AuditLogRow, LoginAttemptRow } from '../types';

interface AuditPayload {
  auditLogs: AuditLogRow[];
  loginAttempts: LoginAttemptRow[];
  summary: {
    totalEvents: number;
    failedLogins: number;
    lockedAccounts: number;
    securityWarnings: number;
  };
}

export function AuditSecurityPage() {
  const [data, setData] = useState<AuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiRequest<AuditPayload>(`/api/audit?${params.toString()}`);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load security audit logs.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const summary = data?.summary;

  return (
    <AppShell title="Audit & Security Monitor" breadcrumb="VERITAS / Administration / Security Telemetry">
      {error && (
        <div role="alert" className="mb-5 p-4 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Audit Events', value: summary?.totalEvents ?? 0 },
          { label: 'Failed Login Attempts', value: summary?.failedLogins ?? 0 },
          { label: 'Locked Accounts', value: summary?.lockedAccounts ?? 0 },
          { label: 'Warnings & Failures', value: summary?.securityWarnings ?? 0 },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-[#E4E5DF] rounded-[4px] p-4">
            <div className="text-[11px] font-semibold text-[#777D77] uppercase tracking-wider">{item.label}</div>
            <div className="mt-2 text-2xl font-bold text-[#252A27] tabular-nums">
              {loading ? '—' : item.value}
            </div>
          </div>
        ))}
      </section>

      <div className="bg-white border border-[#E4E5DF] rounded-[4px] p-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-[#777D77] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            aria-label="Search audit events"
            placeholder="Search by actor email, action type, or details..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px]"
          />
        </div>
        <select
          aria-label="Filter audit events by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px]"
        >
          <option value="">All Outcomes</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="WARNING">WARNING</option>
          <option value="FAILURE">FAILURE</option>
        </select>
      </div>

      <div className="space-y-6">
        <section className="bg-white border border-[#E4E5DF] rounded-[4px] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E4E5DF]">
            <h2 className="text-sm font-semibold text-[#252A27]">System & Cryptographic Audit Log</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                  <th className="py-2.5 px-4">ID</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Resource</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Details</th>
                  <th className="py-2.5 px-4">IP</th>
                  <th className="py-2.5 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E5DF] text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 px-4 text-center text-[#777D77]">
                      Loading audit records...
                    </td>
                  </tr>
                ) : !data?.auditLogs.length ? (
                  <tr>
                    <td colSpan={8} className="py-8 px-4 text-center text-[#777D77]">
                      No audit events match your filters.
                    </td>
                  </tr>
                ) : (
                  data.auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#FAF9F6]">
                      <td className="py-2.5 px-4 font-mono text-[#777D77] tabular-nums">{log.id}</td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-[#252A27] whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-[#252A27]">{log.actor_email}</div>
                        <div className="font-mono text-[10px] text-[#777D77]">{log.actor_role}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                        {log.resource_type}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusLabel value={log.status} />
                      </td>
                      <td className="py-2.5 px-4 text-[#4A504C] max-w-[300px]">{log.details}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                        {log.ip_address}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                        {formatTimestamp(log.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white border border-[#E4E5DF] rounded-[4px] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E4E5DF]">
            <h2 className="text-sm font-semibold text-[#252A27]">Authentication Attempt History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                  <th className="py-2.5 px-4">Email</th>
                  <th className="py-2.5 px-4">Outcome</th>
                  <th className="py-2.5 px-4">Reason</th>
                  <th className="py-2.5 px-4">Source IP</th>
                  <th className="py-2.5 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E5DF] text-xs">
                {!data?.loginAttempts.length ? (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-center text-[#777D77]">
                      No authentication attempts logged yet.
                    </td>
                  </tr>
                ) : (
                  data.loginAttempts.map((att) => (
                    <tr key={att.id} className="hover:bg-[#FAF9F6]">
                      <td className="py-2.5 px-4 font-medium">{att.email}</td>
                      <td className="py-2.5 px-4">
                        <StatusLabel value={att.success ? 'SUCCESS' : 'FAILURE'} />
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[#4A504C]">
                        {att.reason || '—'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[#777D77]">{att.ip_address}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                        {formatTimestamp(att.attempted_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
