import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { Menu, ChevronRight, Activity, Shield } from 'lucide-react';

interface TopNavProps {
  onOpenSidebar: () => void;
}

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Overview',
  jobs: 'Jobs Management',
  queues: 'Queue Monitoring',
  workers: 'Worker Fleet',
  dlq: 'Dead Letter Queue',
  analytics: 'Operational Analytics',
  settings: 'System & Profile Settings',
  health: 'Infrastructure Probes',
};

export const TopNav: React.FC<TopNavProps> = ({ onOpenSidebar }) => {
  const location = useLocation();
  const { user } = useAuth();
  const { isConnected } = useSocket();

  const pathSegments = location.pathname.split('/').filter(Boolean);
  const currentKey = pathSegments[0] || 'dashboard';
  const currentTitle = ROUTE_LABELS[currentKey] || 'Dashboard';

  return (
    <header className="h-16 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-30 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
      {/* Left: Mobile Toggle & Breadcrumbs */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onOpenSidebar}
          className="lg:hidden p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-900 border border-slate-800 transition"
          aria-label="Open sidebar navigation"
        >
          <Menu className="w-5 h-5" />
        </button>

        <nav className="flex items-center space-x-2 text-xs font-medium text-slate-400">
          <Link to="/dashboard" className="hover:text-slate-200 transition">
            TaskFlow
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
          <span className="text-white font-semibold">{currentTitle}</span>
        </nav>
      </div>

      {/* Right: Telemetry status & Actions */}
      <div className="flex items-center space-x-3 sm:space-x-4">
        {/* Environment Chip */}
        <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span>Distributed BullMQ</span>
        </div>

        {/* Real-time Indicator */}
        <div
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            isConnected
              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/60'
              : 'bg-rose-950/40 text-rose-400 border-rose-900/60'
          }`}
          title={isConnected ? 'Socket.io Gateway Connected' : 'Socket.io Gateway Offline'}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
            }`}
          />
          <span className="text-[11px] hidden sm:inline">
            {isConnected ? 'Real-Time Sync' : 'Offline'}
          </span>
        </div>

        {/* Role Chip */}
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs">
          <Shield className="w-3.5 h-3.5 text-indigo-400" />
          <span className="capitalize text-slate-300 font-semibold">{user?.role}</span>
        </div>

        {/* Quick Health Link */}
        <Link
          to="/health"
          className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium transition"
          title="Infrastructure Health Diagnostics"
        >
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span>Health</span>
        </Link>
      </div>
    </header>
  );
};