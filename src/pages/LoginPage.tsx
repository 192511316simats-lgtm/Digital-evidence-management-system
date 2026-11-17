import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { user, setupRequired, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice || null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (setupRequired) {
        navigate('/setup', { replace: true });
      } else if (user) {
        navigate(user.role === 'ADMIN' ? '/admin' : '/investigator', { replace: true });
      }
    }
  }, [loading, setupRequired, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const authenticated = await login(email.trim(), password);
      navigate(authenticated.role === 'ADMIN' ? '/admin' : '/investigator', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F4EF] flex items-center justify-center p-6">
        <div className="text-sm text-[#777D77]">Validating session...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F4EF] flex flex-col justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full mx-auto">
        <div className="mb-6 text-center">
          <div className="inline-flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-[0.14em] text-[#252A27]">VERITAS</span>
            <span className="text-xs font-semibold tracking-[0.16em] text-[#A88755]">FORENSICS</span>
          </div>
          <p className="mt-1.5 text-xs text-[#777D77]">
            Secure Digital Evidence Management System
          </p>
        </div>

        <div className="bg-white border border-[#E4E5DF] rounded-[6px] p-6 sm:p-8">
          <div className="flex items-start gap-3 pb-5 mb-6 border-b border-[#E4E5DF]">
            <div className="p-2 bg-[#202522] text-[#A88755] rounded-[4px] shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#252A27]">Authorized Sign In</h1>
              <p className="mt-1 text-xs text-[#777D77]">
                Authenticate with your institutional credentials to access case vaults and forensic tools.
              </p>
            </div>
          </div>

          {notice && (
            <div className="mb-5 p-3 bg-[#EDF3EE] border border-[#B8CEBD] rounded-[4px] text-xs font-medium text-[#2F5237]">
              {notice}
            </div>
          )}

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
              <label htmlFor="login-email" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                Institutional Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="username"
                placeholder="officer@forensics.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-60 rounded-[4px] transition-colors cursor-pointer"
              >
                <KeyRound className="w-4 h-4" />
                <span>{submitting ? 'Authenticating...' : 'Sign In'}</span>
              </button>
            </div>
          </form>

          <div className="mt-6 pt-4 border-t border-[#E4E5DF] text-[11px] text-[#777D77] leading-relaxed">
            All authentication attempts, cryptographic operations, and evidence access requests are logged for forensic audit compliance.
          </div>
        </div>
      </div>
    </div>
  );
}
