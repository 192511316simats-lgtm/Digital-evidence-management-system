import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AcquireEvidencePage } from './pages/AcquireEvidencePage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AuditSecurityPage } from './pages/AuditSecurityPage';
import { CaseDetailsPage } from './pages/CaseDetailsPage';
import { CasesPage } from './pages/CasesPage';
import { ChainOfCustodyPage } from './pages/ChainOfCustodyPage';
import { DigitalSignaturesPage } from './pages/DigitalSignaturesPage';
import { EvidenceDetailsPage } from './pages/EvidenceDetailsPage';
import { EvidenceRepositoryPage } from './pages/EvidenceRepositoryPage';
import { ForensicReportsPage } from './pages/ForensicReportsPage';
import { IntegrityVerificationPage } from './pages/IntegrityVerificationPage';
import { InvestigatorDashboardPage } from './pages/InvestigatorDashboardPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { SetupPage } from './pages/SetupPage';
import { UserManagementPage } from './pages/UserManagementPage';
import type { UserRole } from './types';

function ProtectedRoute({
  allowedRoles,
  children,
}: {
  allowedRoles?: UserRole[];
  children: React.ReactElement;
}) {
  const { user, loading, setupRequired } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F4EF] flex items-center justify-center p-6">
        <div className="text-sm text-[#777D77]">Verifying authenticated session...</div>
      </div>
    );
  }

  if (setupRequired) {
    return <Navigate to="/setup" replace />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'ADMIN' ? '/admin' : '/investigator'} replace />;
  }

  return children;
}

function RootRedirect() {
  const { user, loading, setupRequired } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F4EF] flex items-center justify-center p-6">
        <div className="text-sm text-[#777D77]">Initializing VERITAS workspace...</div>
      </div>
    );
  }
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'ADMIN' ? '/admin' : '/investigator'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/investigator"
            element={
              <ProtectedRoute allowedRoles={['INVESTIGATOR', 'ADMIN']}>
                <InvestigatorDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cases"
            element={
              <ProtectedRoute>
                <CasesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cases/:caseId"
            element={
              <ProtectedRoute>
                <CaseDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/evidence"
            element={
              <ProtectedRoute>
                <EvidenceRepositoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/evidence/acquire"
            element={
              <ProtectedRoute>
                <AcquireEvidencePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/evidence/:evidenceId"
            element={
              <ProtectedRoute>
                <EvidenceDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/integrity"
            element={
              <ProtectedRoute>
                <IntegrityVerificationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/signatures"
            element={
              <ProtectedRoute>
                <DigitalSignaturesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/custody"
            element={
              <ProtectedRoute>
                <ChainOfCustodyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <ForensicReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <UserManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AuditSecurityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
