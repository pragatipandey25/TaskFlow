import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { Activity, LayoutDashboard, LogOut, Shield, User } from 'lucide-react';
import { UserRole } from '@taskflow/shared';

export const Navbar: React.FC = () => {
  const { user, logout, isAuthenticated } = useAuth();
  const { isConnected, isReconnecting } = useSocket();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getRoleBadgeColor = (role?: UserRole) => {
    switch (role) {
      case UserRole.ADMIN:
        return 'bg-purple-950 text-purple-400 border-purple-800';
      case UserRole.DEVELOPER:
        return 'bg-indigo-950 text-indigo-400 border-indigo-800';
      case UserRole.VIEWER:
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-8">
          <Link to="/" className="flex items-center space-x-3 text-white font-bold text-lg">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-black shadow-lg shadow-indigo-600/30">
              TF
            </div>
            <span>TaskFlow</span>
          </Link>

          {isAuthenticated && (
            <nav className="hidden md:flex items-center space-x-1">
              <Link
                to="/dashboard"
                className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Dashboard</span>
              </Link>
              <Link
                to="/health"
                className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
              >
                <Activity className="w-4 h-4" />
                <span>Telemetry</span>
              </Link>
            </nav>
          )}
        </div>

        <div className="flex items-center space-x-4">
          {isAuthenticated && (
            <div
              className={`flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
                isConnected
                  ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800/60'
                  : isReconnecting
                  ? 'bg-amber-950/50 text-amber-400 border-amber-800/60'
                  : 'bg-slate-800/50 text-slate-400 border-slate-700/60'
              }`}
              title={
                isConnected
                  ? 'Real-time WebSocket connected'
                  : isReconnecting
                  ? 'Reconnecting to real-time events...'
                  : 'Real-time WebSocket disconnected'
              }
            >
              {isConnected ? (
                <>
                  <span className="relative flex h-2 w-2 mr-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="hidden sm:inline">Live</span>
                </>
              ) : isReconnecting ? (
                <>
                  <span className="relative flex h-2 w-2 mr-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                  <span className="hidden sm:inline">Reconnecting</span>
                </>
              ) : (
                <>
                  <span className="inline-flex rounded-full h-2 w-2 bg-slate-500 mr-1.5"></span>
                  <span className="hidden sm:inline">Offline</span>
                </>
              )}
            </div>
          )}

          {isAuthenticated && user ? (
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                  <User className="w-4 h-4" />
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-xs font-semibold text-white leading-none">{user.name}</div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">{user.email}</div>
                </div>
                <span
                  className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md border ${getRoleBadgeColor(
                    user.role
                  )}`}
                >
                  <Shield className="w-2.5 h-2.5 inline mr-1" />
                  {user.role}
                </span>
              </div>

              <button
                onClick={handleLogout}
                title="Log out"
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-3">
              <Link
                to="/login"
                className="px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white transition"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="px-4 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition shadow-md shadow-indigo-600/20"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
