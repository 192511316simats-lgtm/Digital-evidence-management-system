import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiRequest,
  setCsrfToken,
  setFallbackSessionToken,
} from '../lib/api';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  setupRequired: boolean;
  sessionExpiresAt: string | null;
  refreshSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const health = await apiRequest<{
        status: string;
        setupRequired: boolean;
        authenticated: boolean;
      }>('/api/health');
      setSetupRequired(health.setupRequired);

      if (health.setupRequired || !health.authenticated) {
        setUser(null);
        setCsrfToken(null);
        setFallbackSessionToken(null);
        setSessionExpiresAt(null);
        return;
      }

      try {
        const me = await apiRequest<{
          user: User;
          csrfToken: string;
          session: { expires_at: string } | null;
        }>('/api/auth/me');
        setUser(me.user);
        setCsrfToken(me.csrfToken);
        setSessionExpiresAt(me.session?.expires_at || null);
      } catch {
        setUser(null);
        setCsrfToken(null);
        setFallbackSessionToken(null);
        setSessionExpiresAt(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    setFallbackSessionToken(null);

    const res = await apiRequest<{
      user: User;
      csrfToken: string;
      sessionToken?: string;
      expiresAt: string;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setCsrfToken(res.csrfToken);

    // 1. Verify HttpOnly cookie session first
    let me: {
      user: User;
      csrfToken: string;
      session: { expires_at: string } | null;
    } | null = null;

    try {
      me = await apiRequest('/api/auth/me');
    } catch {
      // 2. If browser (e.g., Safari ITP inside cross-site iframe) dropped third-party Set-Cookie,
      // activate sessionStorage Bearer transport bound to the server-side SQLite session.
      if (res.sessionToken) {
        setFallbackSessionToken(res.sessionToken);
        me = await apiRequest('/api/auth/me');
      }
    }

    if (!me) {
      throw new Error('Failed to confirm authenticated session with backend.');
    }

    setUser(me.user);
    setCsrfToken(me.csrfToken);
    setSessionExpiresAt(me.session?.expires_at || res.expiresAt);
    setSetupRequired(false);
    return me.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setCsrfToken(null);
      setFallbackSessionToken(null);
      setSessionExpiresAt(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        setupRequired,
        sessionExpiresAt,
        refreshSession,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
