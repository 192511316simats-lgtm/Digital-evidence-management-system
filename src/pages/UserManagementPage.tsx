import React, { useCallback, useEffect, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { useAuth } from '../context/AuthContext';
import { apiRequest, formatTimestamp } from '../lib/api';
import type { UserRow } from '../types';

export function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [badgeNumber, setBadgeNumber] = useState('');
  const [department, setDepartment] = useState('Digital Forensics');
  const [role, setRole] = useState<'INVESTIGATOR' | 'ADMIN'>('INVESTIGATOR');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (roleFilter) params.set('role', roleFilter);
      const res = await apiRequest<{ users: UserRow[] }>(`/api/users?${params.toString()}`);
      setUsers(res.users);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load user accounts.');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          badgeNumber: badgeNumber.trim(),
          department: department.trim(),
          role,
          password,
        }),
      });
      setName('');
      setEmail('');
      setBadgeNumber('');
      setPassword('');
      setShowCreateModal(false);
      setFeedback('User account created successfully.');
      await loadUsers();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setCreating(false);
    }
  };

  const updateUserStatus = async (target: UserRow, nextStatus: 'ACTIVE' | 'LOCKED' | 'DISABLED') => {
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/api/users/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setFeedback(`Account ${target.email} updated to ${nextStatus}.`);
      await loadUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update user account.');
    }
  };

  return (
    <AppShell
      title="User Management"
      breadcrumb="VERITAS / Administration / Personnel"
      actions={
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] rounded-[4px] whitespace-nowrap cursor-pointer"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Create Investigator</span>
        </button>
      }
    >
      <div className="bg-white border border-[#E4E5DF] rounded-[4px] p-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-[#777D77] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            aria-label="Search users"
            placeholder="Search by name, institutional email, or badge number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
          />
        </div>
        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-xs bg-white border border-[#D4D6CE] rounded-[4px]"
        >
          <option value="">All Roles</option>
          <option value="ADMIN">ADMIN</option>
          <option value="INVESTIGATOR">INVESTIGATOR</option>
        </select>
      </div>

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

      <div className="bg-white border border-[#E4E5DF] rounded-[4px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                <th className="py-3 px-4">Officer Name</th>
                <th className="py-3 px-4">Badge ID</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Created</th>
                <th className="py-3 px-4 text-right">Account Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E5DF] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 px-4 text-center text-[#777D77]">
                    Loading user directory...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 px-4 text-center text-[#777D77]">
                    No matching user accounts found.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-[#FAF9F6]">
                    <td className="py-3 px-4 font-semibold text-[#252A27]">{u.name}</td>
                    <td className="py-3 px-4 font-mono text-[#4A504C]">{u.badge_number}</td>
                    <td className="py-3 px-4 text-[#4A504C]">{u.email}</td>
                    <td className="py-3 px-4 text-[#777D77]">{u.department}</td>
                    <td className="py-3 px-4">
                      <StatusLabel value={u.role} tone={u.role === 'ADMIN' ? 'bronze' : 'neutral'} />
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel value={u.status} />
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                      {formatTimestamp(u.created_at)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {u.id === currentUser?.id ? (
                        <span className="text-[11px] text-[#777D77]">Current Session</span>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          {u.status !== 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={() => updateUserStatus(u, 'ACTIVE')}
                              className="px-2.5 py-1 text-[11px] font-semibold text-[#2F5237] bg-[#EDF3EE] border border-[#B8CEBD] rounded-[3px] cursor-pointer"
                            >
                              Activate
                            </button>
                          )}
                          {u.status === 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={() => updateUserStatus(u, 'DISABLED')}
                              className="px-2.5 py-1 text-[11px] font-semibold text-[#8E2A2A] bg-[#FDF1F1] border border-[#E9BEBE] rounded-[3px] cursor-pointer"
                            >
                              Disable
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Investigator Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-title"
            className="bg-white border border-[#E4E5DF] rounded-[6px] max-w-lg w-full p-6"
          >
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#E4E5DF]">
              <h2 id="create-user-title" className="text-base font-semibold text-[#252A27]">
                Provision Investigator / Officer Account
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

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label htmlFor="new-user-name" className="block text-xs font-semibold mb-1">
                  Full Name
                </label>
                <input
                  id="new-user-name"
                  type="text"
                  required
                  placeholder="e.g., A. Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="new-user-email" className="block text-xs font-semibold mb-1">
                    Institutional Email
                  </label>
                  <input
                    id="new-user-email"
                    type="email"
                    required
                    placeholder="investigator@forensics.org"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                  />
                </div>
                <div>
                  <label htmlFor="new-user-badge" className="block text-xs font-semibold mb-1">
                    Badge Number
                  </label>
                  <input
                    id="new-user-badge"
                    type="text"
                    required
                    placeholder="INV-104"
                    value={badgeNumber}
                    onChange={(e) => setBadgeNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#D4D6CE] rounded-[4px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="new-user-dept" className="block text-xs font-semibold mb-1">
                    Department
                  </label>
                  <input
                    id="new-user-dept"
                    type="text"
                    required
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                  />
                </div>
                <div>
                  <label htmlFor="new-user-role" className="block text-xs font-semibold mb-1">
                    Role
                  </label>
                  <select
                    id="new-user-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'INVESTIGATOR' | 'ADMIN')}
                    className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                  >
                    <option value="INVESTIGATOR">INVESTIGATOR</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="new-user-pass" className="block text-xs font-semibold mb-1">
                  Initial Password (min 8 chars)
                </label>
                <input
                  id="new-user-pass"
                  type="password"
                  required
                  minLength={8}
                  placeholder="Enter secure initial password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-[#252A27] bg-white border border-[#D4D6CE] rounded-[4px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-60 rounded-[4px] cursor-pointer"
                >
                  {creating ? 'Provisioning...' : 'Provision Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
