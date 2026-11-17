import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FilePlus2, Trash2, UserPlus } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { useAuth } from '../context/AuthContext';
import { apiRequest, formatBytes, formatTimestamp } from '../lib/api';
import type { CaseRecord, EvidenceRecord } from '../types';

interface CaseDetailsPayload {
  caseRecord: CaseRecord;
  assignedInvestigators: Array<{
    id: string;
    name: string;
    email: string;
    badge_number: string;
    department: string;
    assigned_at: string;
  }>;
  evidenceItems: EvidenceRecord[];
  caseActivity: Array<{
    id: number;
    event_type: string;
    timestamp: string;
    description: string;
    evidence_code: string;
    actor_name: string;
  }>;
}

export function CaseDetailsPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [data, setData] = useState<CaseDetailsPayload | null>(null);
  const [investigators, setInvestigators] = useState<Array<{ id: string; name: string; badge_number: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('MEDIUM');
  const [editStatus, setEditStatus] = useState('OPEN');
  const [savingEdit, setSavingEdit] = useState(false);

  const [selectedInvestigatorId, setSelectedInvestigatorId] = useState('');
  const [assigning, setAssigning] = useState(false);

  const loadCase = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<CaseDetailsPayload>(`/api/cases/${caseId}`);
      setData(res);
      setEditTitle(res.caseRecord.title);
      setEditDescription(res.caseRecord.description);
      setEditPriority(res.caseRecord.priority);
      setEditStatus(res.caseRecord.status);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load case details.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void loadCase();
  }, [loadCase]);

  useEffect(() => {
    if (isAdmin) {
      apiRequest<{ investigators: Array<{ id: string; name: string; badge_number: string }> }>('/api/investigators')
        .then((res) => setInvestigators(res.investigators))
        .catch(() => {});
    }
  }, [isAdmin]);

  const handleSaveCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;
    setSavingEdit(true);
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/cases/${data.caseRecord.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim(),
          priority: editPriority,
          status: editStatus,
        }),
      });
      setFeedback('Case metadata updated.');
      await loadCase();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update case.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || !selectedInvestigatorId) return;
    setAssigning(true);
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/cases/${data.caseRecord.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedInvestigatorId }),
      });
      setSelectedInvestigatorId('');
      setFeedback('Investigator assigned to case.');
      await loadCase();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to assign investigator.');
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async (userId: string) => {
    if (!data) return;
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/cases/${data.caseRecord.id}/assign/${userId}`, {
        method: 'DELETE',
      });
      setFeedback('Investigator removed from case.');
      await loadCase();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove investigator.');
    }
  };

  const c = data?.caseRecord;

  return (
    <AppShell
      title={c ? `${c.case_code} — ${c.title}` : 'Case Details'}
      breadcrumb="VERITAS / Investigation Cases / Case Dossier"
      actions={
        c ? (
          <Link
            to={`/evidence/acquire?caseId=${c.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] rounded-[4px] whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            <span>Acquire Evidence for Case</span>
          </Link>
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

      {loading || !c ? (
        <div className="bg-white border border-[#E4E5DF] rounded-[4px] p-8 text-xs text-[#777D77]">
          {loading ? 'Loading case dossier...' : 'Case unavailable.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            {/* Case Summary / Edit Form */}
            <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-[#E4E5DF]">
                <div>
                  <div className="font-mono text-xs text-[#777D77]">
                    {c.case_code} · {c.category} · Created {formatTimestamp(c.created_at)}
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-[#252A27]">{c.title}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <StatusLabel value={c.priority} />
                  <StatusLabel value={c.status} />
                </div>
              </div>

              {isAdmin ? (
                <form onSubmit={handleSaveCase} className="space-y-4">
                  <div>
                    <label htmlFor="edit-case-title" className="block text-xs font-semibold mb-1">
                      Title
                    </label>
                    <input
                      id="edit-case-title"
                      type="text"
                      required
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="edit-case-priority" className="block text-xs font-semibold mb-1">
                        Priority
                      </label>
                      <select
                        id="edit-case-priority"
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                      >
                        <option value="LOW">LOW</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="HIGH">HIGH</option>
                        <option value="CRITICAL">CRITICAL</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="edit-case-status" className="block text-xs font-semibold mb-1">
                        Case Status
                      </label>
                      <select
                        id="edit-case-status"
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                      >
                        <option value="OPEN">OPEN</option>
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="UNDER_REVIEW">UNDER REVIEW</option>
                        <option value="CLOSED">CLOSED</option>
                        <option value="ARCHIVED">ARCHIVED</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="edit-case-desc" className="block text-xs font-semibold mb-1">
                      Description
                    </label>
                    <textarea
                      id="edit-case-desc"
                      rows={3}
                      required
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingEdit}
                      className="px-4 py-2 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] rounded-[4px] cursor-pointer"
                    >
                      {savingEdit ? 'Saving Changes...' : 'Save Case Details'}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-[#4A504C] leading-relaxed">{c.description}</p>
              )}
            </section>

            {/* Associated Evidence */}
            <section className="bg-white border border-[#E4E5DF] rounded-[4px]">
              <div className="px-5 py-3.5 border-b border-[#E4E5DF] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#252A27]">
                  Associated Digital Evidence ({data.evidenceItems.length})
                </h3>
                <Link
                  to={`/evidence/acquire?caseId=${c.id}`}
                  className="text-xs font-medium text-[#536B58] hover:underline"
                >
                  Acquire evidence
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E4E5DF] text-[11px] font-semibold text-[#777D77] uppercase">
                      <th className="py-2.5 px-4">Evidence ID</th>
                      <th className="py-2.5 px-4">Filename</th>
                      <th className="py-2.5 px-4">Encryption</th>
                      <th className="py-2.5 px-4">Integrity</th>
                      <th className="py-2.5 px-4">Signature</th>
                      <th className="py-2.5 px-4 text-right">Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E5DF] text-xs">
                    {data.evidenceItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 px-4 text-center text-[#777D77]">
                          No evidence artifacts acquired under this case yet.
                        </td>
                      </tr>
                    ) : (
                      data.evidenceItems.map((ev) => (
                        <tr key={ev.id} className="hover:bg-[#FAF9F6]">
                          <td className="py-2.5 px-4 font-mono font-medium">
                            <Link to={`/evidence/${ev.id}`} className="text-[#536B58] hover:underline">
                              {ev.evidence_code}
                            </Link>
                          </td>
                          <td className="py-2.5 px-4 font-medium max-w-[180px] truncate">{ev.original_filename}</td>
                          <td className="py-2.5 px-4">
                            <StatusLabel value={ev.encryption_status} />
                          </td>
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

          <div className="space-y-6">
            {/* Assigned Investigators */}
            <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5">
              <h3 className="text-sm font-semibold text-[#252A27] pb-3 border-b border-[#E4E5DF]">
                Assigned Investigators
              </h3>
              <ul className="divide-y divide-[#E4E5DF] my-3">
                {data.assignedInvestigators.length === 0 ? (
                  <li className="py-3 text-xs text-[#777D77]">No investigators assigned yet.</li>
                ) : (
                  data.assignedInvestigators.map((inv) => (
                    <li key={inv.id} className="py-3 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#252A27] truncate">{inv.name}</div>
                        <div className="font-mono text-[11px] text-[#777D77] truncate">
                          {inv.badge_number} · {inv.email}
                        </div>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          aria-label={`Remove ${inv.name} from case`}
                          onClick={() => handleUnassign(inv.id)}
                          className="p-1.5 text-[#777D77] hover:text-[#8E2A2A] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </li>
                  ))
                )}
              </ul>

              {isAdmin && (
                <form onSubmit={handleAssign} className="pt-3 border-t border-[#E4E5DF] space-y-2.5">
                  <label htmlFor="assign-inv-select" className="block text-xs font-semibold text-[#252A27]">
                    Assign Investigator
                  </label>
                  <select
                    id="assign-inv-select"
                    value={selectedInvestigatorId}
                    onChange={(e) => setSelectedInvestigatorId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#D4D6CE] rounded-[4px]"
                  >
                    <option value="">Select active investigator...</option>
                    {investigators.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.name} ({inv.badge_number})
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={!selectedInvestigatorId || assigning}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#202522] hover:bg-[#323A35] disabled:opacity-50 rounded-[4px] cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{assigning ? 'Assigning...' : 'Assign to Case'}</span>
                  </button>
                </form>
              )}
            </section>

            {/* Case Activity */}
            <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5">
              <h3 className="text-sm font-semibold text-[#252A27] pb-3 border-b border-[#E4E5DF]">
                Case Evidence Activity
              </h3>
              <div className="divide-y divide-[#E4E5DF]">
                {data.caseActivity.length === 0 ? (
                  <p className="py-4 text-xs text-[#777D77]">No evidence custody events recorded yet.</p>
                ) : (
                  data.caseActivity.map((act) => (
                    <div key={act.id} className="py-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#536B58]">{act.evidence_code}</span>
                        <StatusLabel value={act.event_type} />
                      </div>
                      <p className="mt-1 text-[#252A27]">{act.description}</p>
                      <div className="mt-1 text-[11px] font-mono text-[#777D77]">
                        {act.actor_name} · {formatTimestamp(act.timestamp)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}
