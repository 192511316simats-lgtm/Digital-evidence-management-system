import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { useAuth } from '../context/AuthContext';
import { apiRequest, formatTimestamp } from '../lib/api';

interface CryptoInfoPayload {
  cryptography: {
    symmetricCipher: string;
    keyWrapping: string;
    wrappingKeyFingerprint: string;
    digitalSignature: string;
    signingKeyFingerprint: string;
    integrityHash: string;
    custodyChainModel: string;
  };
  sessionPolicy: {
    cookieFlags: string;
    csrfProtection: string;
    lockoutPolicy: string;
    maxEvidenceSizeMb: number;
  };
}

export function SettingsPage() {
  const { user, sessionExpiresAt } = useAuth();
  const [info, setInfo] = useState<CryptoInfoPayload | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<CryptoInfoPayload>('/api/settings/crypto-info')
      .then(setInfo)
      .catch(() => {});
  }, []);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setSaving(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setFeedback('Your account password has been updated.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="Settings & Cryptographic Policy" breadcrumb="VERITAS / Configuration">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Officer Profile & Password Update */}
        <div className="space-y-6">
          <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5">
            <h2 className="text-sm font-semibold text-[#252A27] pb-3 border-b border-[#E4E5DF]">
              Authenticated Officer Profile
            </h2>
            {user && (
              <dl className="mt-4 space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-[#777D77]">Officer Name</dt>
                  <dd className="font-semibold text-[#252A27]">{user.name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#777D77]">Institutional Email</dt>
                  <dd className="font-mono">{user.email}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#777D77]">Badge Number</dt>
                  <dd className="font-mono font-semibold">{user.badgeNumber}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#777D77]">Department</dt>
                  <dd>{user.department}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#777D77]">Assigned Role</dt>
                  <dd className="font-mono font-semibold text-[#536B58]">{user.role}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#777D77]">Session Expires</dt>
                  <dd className="font-mono text-[11px]">{formatTimestamp(sessionExpiresAt)}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5">
            <h2 className="text-sm font-semibold text-[#252A27] pb-3 border-b border-[#E4E5DF]">
              Update Password
            </h2>

            {error && (
              <div role="alert" className="mt-4 p-3 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
                {error}
              </div>
            )}
            {feedback && (
              <div className="mt-4 p-3 bg-[#EDF3EE] border border-[#B8CEBD] rounded-[4px] text-xs text-[#2F5237]">
                {feedback}
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="mt-4 space-y-4">
              <div>
                <label htmlFor="cur-pass" className="block text-xs font-semibold mb-1">
                  Current Password
                </label>
                <input
                  id="cur-pass"
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                />
              </div>
              <div>
                <label htmlFor="new-pass" className="block text-xs font-semibold mb-1">
                  New Password (min 8 characters)
                </label>
                <input
                  id="new-pass"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                />
              </div>
              <div>
                <label htmlFor="conf-pass" className="block text-xs font-semibold mb-1">
                  Confirm New Password
                </label>
                <input
                  id="conf-pass"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px]"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-50 rounded-[4px] cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{saving ? 'Updating...' : 'Update Password'}</span>
              </button>
            </form>
          </section>
        </div>

        {/* Cryptographic Parameters & Security Mechanisms */}
        <section className="bg-white border border-[#E4E5DF] rounded-[4px] p-5 h-fit">
          <h2 className="text-sm font-semibold text-[#252A27] pb-3 border-b border-[#E4E5DF]">
            Active Cryptographic & Security Mechanisms
          </h2>
          {info ? (
            <dl className="mt-4 space-y-3 text-xs">
              <div>
                <dt className="text-[#777D77] font-semibold">Symmetric Vault Encryption</dt>
                <dd className="mt-0.5 font-mono text-[#252A27]">{info.cryptography.symmetricCipher}</dd>
              </div>
              <div>
                <dt className="text-[#777D77] font-semibold">Asymmetric Key Wrapping</dt>
                <dd className="mt-0.5 font-mono text-[#252A27]">{info.cryptography.keyWrapping}</dd>
                <dd className="mt-0.5 font-mono text-[11px] text-[#777D77]">
                  Fingerprint: {info.cryptography.wrappingKeyFingerprint}
                </dd>
              </div>
              <div>
                <dt className="text-[#777D77] font-semibold">Digital Signature Scheme</dt>
                <dd className="mt-0.5 font-mono text-[#252A27]">{info.cryptography.digitalSignature}</dd>
                <dd className="mt-0.5 font-mono text-[11px] text-[#777D77]">
                  Fingerprint: {info.cryptography.signingKeyFingerprint}
                </dd>
              </div>
              <div>
                <dt className="text-[#777D77] font-semibold">Integrity Digest</dt>
                <dd className="mt-0.5 font-mono text-[#252A27]">{info.cryptography.integrityHash}</dd>
              </div>
              <div>
                <dt className="text-[#777D77] font-semibold">Chain of Custody Model</dt>
                <dd className="mt-0.5 text-[#4A504C]">{info.cryptography.custodyChainModel}</dd>
              </div>
              <div className="pt-3 border-t border-[#E4E5DF]">
                <dt className="text-[#777D77] font-semibold">Session & Network Security</dt>
                <dd className="mt-1 text-[#4A504C]">{info.sessionPolicy.cookieFlags}</dd>
                <dd className="mt-0.5 text-[#4A504C]">{info.sessionPolicy.csrfProtection}</dd>
                <dd className="mt-0.5 text-[#4A504C]">{info.sessionPolicy.lockoutPolicy}</dd>
                <dd className="mt-0.5 font-mono text-[11px] text-[#777D77]">
                  Max Evidence Upload Size: {info.sessionPolicy.maxEvidenceSizeMb} MB
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-xs text-[#777D77]">Loading cryptographic policy...</p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
