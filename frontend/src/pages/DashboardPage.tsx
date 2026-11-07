import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Navbar } from '../components/layout/Navbar';
import { Shield, Clock, Key, Activity, Layers, Cpu, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Welcome Banner */}
        <div className="p-8 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl shadow-2xl relative overflow-hidden">
          <div className="relative z-10">
            <span className="px-3 py-1 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs font-semibold uppercase tracking-wider rounded-full inline-block mb-3">
              Milestone 2 Verified • Authentication & RBAC Active
            </span>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Welcome back, {user?.name}
            </h1>
            <p className="mt-2 text-sm text-slate-400 max-w-2xl">
              You are authenticated as <span className="text-white font-semibold">{user?.email}</span> with{' '}
              <span className="text-indigo-400 font-semibold uppercase">{user?.role}</span> permissions. Distributed job queue orchestration and worker controls are ready for activation.
            </p>
          </div>
        </div>

        {/* User Identity & Session Metrics Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2.5 bg-indigo-600/20 text-indigo-400 rounded-lg">
                <Shield className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Role & Access</h3>
            </div>
            <div className="text-2xl font-bold text-white capitalize">{user?.role}</div>
            <p className="text-xs text-slate-500 mt-2">
              Status:{' '}
              <span className="text-emerald-400 font-semibold">
                {user?.isActive ? 'Active & Verified' : 'Inactive'}
              </span>
            </p>
          </div>

          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2.5 bg-purple-600/20 text-purple-400 rounded-lg">
                <Key className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Token Strategy</h3>
            </div>
            <div className="text-2xl font-bold text-white">Rotating JWT</div>
            <p className="text-xs text-slate-500 mt-2">
              Access Token: 15m • Refresh Token: 7d (SHA-256 Hashed)
            </p>
          </div>

          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2.5 bg-emerald-600/20 text-emerald-400 rounded-lg">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Session Activity</h3>
            </div>
            <div className="text-sm font-medium text-white truncate">
              {user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'First Session'}
            </div>
            <p className="text-xs text-slate-500 mt-2">Member Since: {new Date(user?.createdAt || Date.now()).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Milestone Modules Grid */}
        <div>
          <h2 className="text-lg font-bold text-white mb-4">TaskFlow Orchestration Modules</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Link
              to="/health"
              className="p-6 bg-slate-900 border border-slate-800 hover:border-indigo-600/50 rounded-xl transition group shadow-lg flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-emerald-600/20 text-emerald-400 rounded-lg group-hover:scale-105 transition">
                    <Activity className="w-6 h-6" />
                  </div>
                  <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Active (M1)</span>
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mb-1">Infrastructure Telemetry</h3>
                <p className="text-xs text-slate-400">
                  Real-time probes for MongoDB 7.0 document persistence, Redis 7.2 in-memory broker, and Node.js process health.
                </p>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800 text-xs font-semibold text-indigo-400 group-hover:text-indigo-300">
                View live metrics →
              </div>
            </Link>

            <div className="p-6 bg-slate-900/50 border border-slate-800 rounded-xl shadow-lg flex flex-col justify-between opacity-75">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-indigo-600/20 text-indigo-400 rounded-lg">
                    <Layers className="w-6 h-6" />
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                    Milestone 3
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mb-1">Job Ingestion & BullMQ</h3>
                <p className="text-xs text-slate-400">
                  Priority scheduling, cryptographic idempotency keys, and BullMQ Redis queue publishing.
                </p>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-500 font-medium">
                Scheduled for Next Milestone
              </div>
            </div>

            <div className="p-6 bg-slate-900/50 border border-slate-800 rounded-xl shadow-lg flex flex-col justify-between opacity-75">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 bg-purple-600/20 text-purple-400 rounded-lg">
                    <Cpu className="w-6 h-6" />
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                    Milestone 4
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mb-1">Distributed Worker Fleet</h3>
                <p className="text-xs text-slate-400">
                  Concurrent task execution, atomic distributed locks, and stalled job recovery watchdogs.
                </p>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-500 font-medium">
                Scheduled for Milestone 4
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
