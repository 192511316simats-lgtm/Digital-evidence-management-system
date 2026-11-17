import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export function SetupPage() {
  const { setupRequired, user, loading, refreshSession } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('K. Divya');
  const [email, setEmail] = useState('');
  const [badgeNumber, setBadgeNumber] = useState('');
  const [department, setDepartment] = useState('Digital Forensics');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (user) {
        navigate(user.role === 'ADMIN' ? '/admin' : '/investigator', { replace: true });
      } else if (!setupRequired) {
        navigate('/login', { replace: true });
      }
    }
  }, [loading, setupRequired, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Password and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          badgeNumber: badgeNumber.trim(),
          department: department.trim(),
          password,
          confirmPassword,
        }),
      });
      await refreshSession();
      navigate('/login', {
        replace: true,
        state: { notice: 'Initial administrator registered and setup locked. Sign in to continue.' },
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Initial setup failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F4EF] flex items-center justify-center p-6">
        <div className="text-sm text-[#777D77]">Verifying system initialization state...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F4EF] flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-lg w-full mx-auto">
        <div className="mb-6 text-center">
          <div className="inline-flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-[0.14em] text-[#252A27]">VERITAS</span>
            <span className="text-xs font-semibold tracking-[0.16em] text-[#A88755]">FORENSICS</span>
          </div>
          <p className="mt-1.5 text-xs text-[#777D77]">
            Digital Evidence Management System · Initial Provisioning
          </p>
        </div>

        <div className="bg-white border border-[#E4E5DF] rounded-[6px] p-6 sm:p-8">
          <div className="flex items-start gap-3 pb-5 mb-6 border-b border-[#E4E5DF]">
            <div className="p-2 bg-[#202522] text-[#A88755] rounded-[4px] shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#252A27]">
                Initial Administrator Setup
              </h1>
              <p className="mt-1 text-xs text-[#777D77] leading-relaxed">
                No administrator account exists in the database. Register the primary system administrator to initialize and lock setup.
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 p-3 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs font-medium text-[#8E2A2A]"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="setup-name" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                Administrator Name
              </label>
              <input
                id="setup-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="setup-email" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                  Institutional Email
                </label>
                <input
                  id="setup-email"
                  type="email"
                  required
                  placeholder="admin@forensics.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
                />
              </div>

              <div>
                <label htmlFor="setup-badge" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                  Badge Number
                </label>
                <input
                  id="setup-badge"
                  type="text"
                  required
                  placeholder="ADM-001"
                  value={badgeNumber}
                  onChange={(e) => setBadgeNumber(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="setup-dept" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                Department
              </label>
              <input
                id="setup-dept"
                type="text"
                required
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="setup-password" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                  Password
                </label>
                <input
                  id="setup-password"
                  type="password"
                  required
                  minLength={8}
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
                />
              </div>

              <div>
                <label htmlFor="setup-confirm" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="setup-confirm"
                  type="password"
                  required
                  minLength={8}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-60 rounded-[4px] transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>{submitting ? 'Registering Administrator...' : 'Complete Initial Setup'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
