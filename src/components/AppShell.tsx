import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FolderKanban,
  GitCommitHorizontal,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

export function AppShell({
  title,
  breadcrumb,
  actions,
  children,
}: {
  title: string;
  breadcrumb?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!user) return null;

  const isAdmin = user.role === 'ADMIN';

  const navItems: NavItem[] = [
    {
      to: isAdmin ? '/admin' : '/investigator',
      label: isAdmin ? 'Admin Dashboard' : 'Investigator Dashboard',
      icon: LayoutDashboard,
    },
    {
      to: '/cases',
      label: 'Investigation Cases',
      icon: FolderKanban,
    },
    {
      to: '/evidence',
      label: 'Evidence Repository',
      icon: HardDrive,
    },
    {
      to: '/evidence/acquire',
      label: 'Acquire Evidence',
      icon: FilePlus2,
    },
    {
      to: '/integrity',
      label: 'Integrity Verification',
      icon: ShieldCheck,
    },
    {
      to: '/signatures',
      label: 'Digital Signatures',
      icon: FileCheck2,
    },
    {
      to: '/custody',
      label: 'Chain of Custody',
      icon: GitCommitHorizontal,
    },
    {
      to: '/reports',
      label: 'Forensic Reports',
      icon: FileSpreadsheet,
    },
    ...(isAdmin
      ? [
          {
            to: '/users',
            label: 'User Management',
            icon: Users,
            adminOnly: true,
          },
          {
            to: '/audit',
            label: 'Audit & Security',
            icon: ShieldAlert,
            adminOnly: true,
          },
        ]
      : []),
    {
      to: '/settings',
      label: 'Settings',
      icon: Settings,
    },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#202522] text-[#E8EAE5]">
      <div className="px-5 h-14 flex items-center justify-between border-b border-white/10 shrink-0">
        <NavLink
          to={isAdmin ? '/admin' : '/investigator'}
          onClick={() => setMobileNavOpen(false)}
          className="flex items-baseline gap-2 whitespace-nowrap shrink-0 focus:outline-none"
        >
          <span className="text-[15px] font-bold tracking-[0.12em] text-white">VERITAS</span>
          <span className="text-[11px] font-medium tracking-[0.14em] text-[#A88755]">FORENSICS</span>
        </NavLink>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 text-[#B4B9B3] hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav aria-label="Primary Sidebar Navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            location.pathname === item.to ||
            (item.to !== '/admin' &&
              item.to !== '/investigator' &&
              item.to !== '/evidence' &&
              location.pathname.startsWith(item.to + '/')) ||
            (item.to === '/evidence' &&
              location.pathname.startsWith('/evidence/') &&
              location.pathname !== '/evidence/acquire');

          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileNavOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium rounded-[4px] transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#536B58] text-white'
                  : 'text-[#C2C7C1] hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0 opacity-85" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 shrink-0">
        <div className="text-[12px] font-semibold text-white truncate">{user.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#A4ABA4] font-mono truncate">
          <span>{user.badgeNumber}</span>
          <span aria-hidden="true">·</span>
          <span>{user.role}</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium text-[#E8EAE5] bg-white/5 hover:bg-white/10 border border-white/10 rounded-[4px] transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F5F4EF] text-[#252A27] flex">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 fixed inset-y-0 left-0 z-30 border-r border-[#2B312D]">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[80vw] h-full z-10">{sidebarContent}</aside>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-[#E4E5DF] px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-1 text-[#252A27] hover:bg-[#F5F4EF] rounded-[4px]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-[#777D77] truncate">
                {breadcrumb || 'VERITAS Digital Evidence Management'}
              </div>
              <h1 className="text-[15px] font-semibold text-[#252A27] truncate leading-tight">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {actions}
            <div className="hidden sm:flex items-center gap-2 text-[12px] text-[#777D77] border-l border-[#E4E5DF] pl-3 whitespace-nowrap">
              <Activity className="w-3.5 h-3.5 text-[#536B58]" />
              <span className="font-medium text-[#252A27]">{user.name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px]">{user.badgeNumber}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
