import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { UserRole } from '@taskflow/shared';
import {
  Settings,
  Shield,
  Radio,
  Server,
  LogOut,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const SettingsPage: React.FC = () => {
  const { user, logout } = useAuth();
  const { isConnected, isReconnecting, connectionError } = useSocket();
  const navigate = useNavigate();

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getRoleBadge = (role?: UserRole) => {
    switch (role) {
      case UserRole.ADMIN:
        return 'bg-purple-950/80 text-purple-400 border-purple-800';
      case UserRole.DEVELOPER:
        return 'bg-indigo-950/80 text-indigo-400 border-indigo-800';
      case UserRole.VIEWER:
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="pb-6 border-b border-slate-800">
        <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-400" />
          System Settings & Operator Profile
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage user session credentials, review RBAC role entitlements, and inspect real-time WebSocket connection diagnostics.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User Identity & Security Card */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center font-bold text-lg uppercase shadow-inner">
                  {user?.name ? user.name.slice(0, 2) : 'TF'}
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">{user?.name}</h2>
                  <p className="text-xs text-slate-400">{user?.email}</p>
                </div>
              </div>
              <span
                className={`text-xs uppercase font-bold px-3 py-1 rounded-full border ${getRoleBadge(
                  user?.role
                )}`}
              >
                {user?.role}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 block mb-1">User Identifier</span>
                <div className="flex items-center justify-between font-mono text-slate-200">
                  <span className="truncate">{user?.id}</span>
                  <button
                    onClick={() => user?.id && handleCopy(user.id, 'userId')}
                    className="text-slate-500 hover:text-slate-300 p-1"
                    title="Copy User ID"
                  >
                    {copiedKey === 'userId' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 block mb-1">Account State</span>
                <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  {user?.isActive ? 'Active & Authenticated' : 'Suspended'}
                </span>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 block mb-1">Registered Since</span>
                <span className="text-slate-200 font-medium">
                  {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                </span>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 block mb-1">Last Sign-In Timestamp</span>
                <span className="text-slate-200 font-medium">
                  {user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Active session'}
                </span>
              </div>
            </div>

            {/* Session Actions */}
            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-200">Active Authentication Session</p>
                <p className="text-[11px] text-slate-400">
                  JWT 15m expiration with automatic refresh rotation and server socket eviction.
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold transition flex items-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Revoke Session</span>
              </button>
            </div>
          </div>

          {/* RBAC Entitlements Matrix */}
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-400" />
              Role-Based Access Control (RBAC) Entitlements
            </h3>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">System Capability</th>
                    <th className="py-2.5 px-3 text-center">Viewer</th>
                    <th className="py-2.5 px-3 text-center">Developer</th>
                    <th className="py-2.5 px-3 text-center">Admin</th>
                    <th className="py-2.5 px-3 text-right">Your Entitlement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 text-slate-300">
                  <tr>
                    <td className="py-2 px-3 font-medium">View Jobs, Queues & Workers</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓</td>
                    <td className="py-2 px-3 text-right text-emerald-400 font-semibold">Granted</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium">Submit Background Jobs</td>
                    <td className="py-2 px-3 text-center text-rose-400">✗</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓</td>
                    <td className="py-2 px-3 text-right font-semibold">
                      {user?.role === UserRole.VIEWER ? (
                        <span className="text-rose-400">Denied</span>
                      ) : (
                        <span className="text-emerald-400">Granted</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium">Cancel & Retry Jobs</td>
                    <td className="py-2 px-3 text-center text-rose-400">✗</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓ (Own)</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓ (All)</td>
                    <td className="py-2 px-3 text-right font-semibold">
                      {user?.role === UserRole.VIEWER ? (
                        <span className="text-rose-400">Denied</span>
                      ) : user?.role === UserRole.DEVELOPER ? (
                        <span className="text-indigo-400">Own Jobs</span>
                      ) : (
                        <span className="text-emerald-400">All Jobs</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium">Single & Bulk DLQ Redrive</td>
                    <td className="py-2 px-3 text-center text-rose-400">✗</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓</td>
                    <td className="py-2 px-3 text-right font-semibold">
                      {user?.role === UserRole.VIEWER ? (
                        <span className="text-rose-400">Denied</span>
                      ) : (
                        <span className="text-emerald-400">Granted</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium">Create Queues & Manage Roles</td>
                    <td className="py-2 px-3 text-center text-rose-400">✗</td>
                    <td className="py-2 px-3 text-center text-rose-400">✗</td>
                    <td className="py-2 px-3 text-center text-emerald-400 font-bold">✓</td>
                    <td className="py-2 px-3 text-right font-semibold">
                      {user?.role === UserRole.ADMIN ? (
                        <span className="text-emerald-400">Granted</span>
                      ) : (
                        <span className="text-rose-400">Admin Only</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Real-time Socket Diagnostic Panel */}
        <div className="space-y-6">
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" />
              Socket.io Telemetry Gateway
            </h3>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400">Gateway Status</span>
                <span
                  className={`font-semibold flex items-center gap-1.5 ${
                    isConnected
                      ? 'text-emerald-400'
                      : isReconnecting
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isConnected
                        ? 'bg-emerald-400 animate-pulse'
                        : isReconnecting
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-rose-500'
                    }`}
                  />
                  {isConnected
                    ? 'Connected (LIVE)'
                    : isReconnecting
                    ? 'Reconnecting'
                    : 'Disconnected'}
                </span>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400">Transport Layer</span>
                <span className="font-mono text-slate-200">
                  {isConnected ? 'WebSocket / WSS' : 'N/A'}
                </span>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400">Cluster Adapter Mode</span>
                <span className="font-medium text-indigo-400">
                  Distributed Redis Pub/Sub
                </span>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 block mb-1">Active Gateway Endpoint</span>
                <span className="font-mono text-slate-200 text-[11px] break-all">
                  {import.meta.env.VITE_SOCKET_URL || window.location.origin}
                </span>
              </div>

              {connectionError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{connectionError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Engine Metadata */}
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-3 text-xs">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              Engine Architecture
            </h3>
            <div className="space-y-2 text-slate-400">
              <div className="flex justify-between">
                <span>TaskFlow Core:</span>
                <span className="text-slate-200 font-semibold">v1.0 (Milestone 7)</span>
              </div>
              <div className="flex justify-between">
                <span>Background Queue:</span>
                <span className="text-slate-200">BullMQ + Redis 7.2</span>
              </div>
              <div className="flex justify-between">
                <span>Primary Datastore:</span>
                <span className="text-slate-200">MongoDB ReplicaSet</span>
              </div>
              <div className="flex justify-between">
                <span>Real-Time Gateway:</span>
                <span className="text-slate-200">Socket.io v4</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};