import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, X } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { useAuth } from '../context/AuthContext';
import { apiRequest, formatTimestamp } from '../lib/api';
import type { CaseRecord } from '../types';

interface InvestigatorOption {
  id: string;
  name: string;
  badge_number: string;
  email: string;
}

export function CasesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [investigators, setInvestigators] = useState<InvestigatorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Network Intrusion');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('HIGH');
  const [assignedInvestigatorId, setAssignedInvestigatorId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (sortBy) params.set('sort', sortBy);

      const res = await apiRequest<{ cases: CaseRecord[] }>(`/api/cases?${params.toString()}`);
      setCases(res.cases);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load investigation cases.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, priorityFilter, sortBy]);

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

  useEffect(() => {
    if (isAdmin) {
      apiRequest<{ investigators: InvestigatorOption[] }>('/api/investigators')
        .then((res) => setInvestigators(res.investigators))
        .catch(() => {});
    }
  }, [isAdmin]);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await apiRequest('/api/cases', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category: category.trim(),
          priority,
          status: 'OPEN',
          assignedInvestigatorId: assignedInvestigatorId || null,
        }),
      });
      setTitle('');
      setDescription('');
      setAssignedInvestigatorId('');
      setShowCreateModal(false);
      await fetchCases();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create case.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell
      title="Investigation Cases"
      breadcrumb="VERITAS / Case Management"
      actions={
        isAdmin ? (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] rounded-[4px] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Case</span>
          </button>
        ) : undefined
      }
    >
      {/* Filters & Search Toolbar */}
      <div className="bg-white border border-[#E4E5DF] rounded-[4px] p-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-[#777D77] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            aria-label="Search cases"
            placeholder="Search by case ID, title, or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
          />
        </div>

        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
        >
          <option value="">All Statuses</option>
          <option value="OPEN">OPEN</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="UNDER_REVIEW">UNDER REVIEW</option>
          <option value="CLOSED">CLOSED</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </select>

        <select
          aria-label="Filter by priority"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
        >
          <option value="">All Priorities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>

        <select
          aria-label="Sort cases"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="priority">Highest Priority</option>
          <option value="title">Title (A–Z)</option>
        </select>
      </div>

      {error && (
        <div role="alert" className="mb-5 p-4 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
          {error}
        </div>
      )}

      {/* Cases Table */}
      <div className="bg-white border border-[#E4E5DF] rounded-[4px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                <th className="py-3 px-4">Case ID</th>
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Assigned Investigator(s)</th>
                <th className="py-3 px-4 text-right">Evidence</th>
                <th className="py-3 px-4">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E5DF] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 px-4 text-center text-[#777D77]">
                    Loading investigation cases...
                  </td>
                </tr>
              ) : cases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 px-4 text-center text-[#777D77]">
                    {isAdmin
                      ? 'No investigation cases match your criteria. Create a new case to begin.'
                      : 'No assigned investigation cases match your criteria.'}
                  </td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr key={c.id} className="hover:bg-[#FAF9F6]">
                    <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                      <Link to={`/cases/${c.id}`} className="text-[#536B58] hover:underline">
                        {c.case_code}
                      </Link>
                    </td>
                    <td className="py-3 px-4 font-medium text-[#252A27] max-w-[240px]">
                      <Link to={`/cases/${c.id}`} className="hover:underline block truncate">
                        {c.title}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-[#777D77] whitespace-nowrap">{c.category}</td>
                    <td className="py-3 px-4">
                      <StatusLabel value={c.priority} />
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel value={c.status} />
                    </td>
                    <td className="py-3 px-4 text-[#4A504C] max-w-[200px] truncate">
                      {c.assigned_investigators || 'Unassigned'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {c.evidence_count ?? 0}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                      {formatTimestamp(c.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Case Modal (Admin) */}
      {showCreateModal && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-case-title"
            className="bg-white border border-[#E4E5DF] rounded-[6px] max-w-lg w-full p-6"
          >
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#E4E5DF]">
              <h2 id="create-case-title" className="text-base font-semibold text-[#252A27]">
                Create Investigation Case
              </h2>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-[#777D77] hover:text-[#252A27]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div role="alert" className="mb-4 p-3 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateCase} className="space-y-4">
              <div>
                <label htmlFor="case-title" className="block text-xs font-semibold text-[#252A27] mb-1">
                  Case Title
                </label>
                <input
                  id="case-title"
                  type="text"
                  required
                  placeholder="e.g., Core Banking Gateway Exfiltration"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="case-category" className="block text-xs font-semibold text-[#252A27] mb-1">
                    Category
                  </label>
                  <select
                    id="case-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
                  >
                    <option value="Network Intrusion">Network Intrusion</option>
                    <option value="Malware Analysis">Malware Analysis</option>
                    <option value="Data Exfiltration">Data Exfiltration</option>
                    <option value="Insider Threat">Insider Threat</option>
                    <option value="Financial Fraud">Financial Fraud</option>
                    <option value="Endpoint Forensics">Endpoint Forensics</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="case-priority" className="block text-xs font-semibold text-[#252A27] mb-1">
                    Priority
                  </label>
                  <select
                    id="case-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')}
                    className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="case-assignee" className="block text-xs font-semibold text-[#252A27] mb-1">
                  Assign Investigator (Optional)
                </label>
                <select
                  id="case-assignee"
                  value={assignedInvestigatorId}
                  onChange={(e) => setAssignedInvestigatorId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
                >
                  <option value="">Assign later</option>
                  {investigators.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name} ({inv.badge_number})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="case-desc" className="block text-xs font-semibold text-[#252A27] mb-1">
                  Case Scope & Description
                </label>
                <textarea
                  id="case-desc"
                  required
                  rows={3}
                  placeholder="Describe incident scope, seized assets, and forensic objectives..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-[#252A27] bg-white border border-[#D4D6CE] rounded-[4px] hover:bg-[#F5F4EF]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-60 rounded-[4px] cursor-pointer"
                >
                  {creating ? 'Creating...' : 'Create Case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
