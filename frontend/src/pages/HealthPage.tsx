import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/api.client';
import { Activity, Server, Database, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

interface HealthData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  timestamp: string;
  environment: string;
  version: string;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
  dependencies?: {
    mongodb: {
      status: string;
      readyState: number;
    };
    redis: {
      status: string;
      latencyMs?: number;
    };
  };
}

export const HealthPage: React.FC = () => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: HealthData }>('/health/ready');
      setHealth(res.data.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to reach health endpoint');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 flex flex-col items-center justify-center">
      <div className="max-w-3xl w-full bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl">
        <div className="flex items-center justify-between pb-6 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-indigo-600/20 text-indigo-400 rounded-lg">
              <Activity className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">TaskFlow Telemetry & Health</h1>
              <p className="text-sm text-slate-400">Milestone 1 — Core Infrastructure Diagnostic</p>
            </div>
          </div>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-medium transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {error && (
          <div className="mt-6 p-4 bg-red-950/50 border border-red-800/50 rounded-lg flex items-center space-x-3 text-red-300">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div className="text-sm">{error}</div>
          </div>
        )}

        {health && (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>System Status</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-lg font-semibold capitalize text-emerald-400">{health.status}</div>
                <div className="text-xs text-slate-500 mt-1">Uptime: {health.uptimeSeconds}s</div>
              </div>

              <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>Environment</span>
                  <Server className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-lg font-semibold uppercase text-indigo-300">{health.environment}</div>
                <div className="text-xs text-slate-500 mt-1">v{health.version}</div>
              </div>

              <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>Heap Memory</span>
                  <Database className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-lg font-semibold text-purple-300">{health.memory.heapUsedMb} MB</div>
                <div className="text-xs text-slate-500 mt-1">Total: {health.memory.heapTotalMb} MB</div>
              </div>
            </div>

            {health.dependencies && (
              <div className="border-t border-slate-800 pt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  Infrastructure Dependencies
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-slate-200">MongoDB 7.0</div>
                      <div className="text-xs text-slate-500">Status: {health.dependencies.mongodb.status}</div>
                    </div>
                    <span
                      className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                        health.dependencies.mongodb.status === 'connected'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {health.dependencies.mongodb.status}
                    </span>
                  </div>

                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-slate-200">Redis 7.2 (BullMQ Broker)</div>
                      <div className="text-xs text-slate-500">
                        Status: {health.dependencies.redis.status}
                        {health.dependencies.redis.latencyMs !== undefined && ` (${health.dependencies.redis.latencyMs}ms)`}
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                        health.dependencies.redis.status === 'connected'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {health.dependencies.redis.status}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
