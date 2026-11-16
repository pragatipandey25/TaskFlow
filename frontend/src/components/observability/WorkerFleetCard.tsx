import React from 'react';
import { WorkerResponse, WorkerStatus } from '@taskflow/shared';
import { Cpu, HardDrive, Server, Zap, RefreshCw } from 'lucide-react';

interface WorkerFleetProps {
  workers: WorkerResponse[];
  isLoading: boolean;
  onRefresh: () => void;
}

export const WorkerFleetCard: React.FC<WorkerFleetProps> = ({
  workers,
  isLoading,
  onRefresh,
}) => {
  const getStatusBadge = (status: WorkerStatus) => {
    switch (status) {
      case WorkerStatus.HEALTHY:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Healthy
          </span>
        );
      case WorkerStatus.DEGRADED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Degraded
          </span>
        );
      case WorkerStatus.DEAD:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            Dead / Inactive
          </span>
        );
      default:
        return null;
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatElapsed = (isoDate: string) => {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
    if (elapsedSec < 5) return 'just now';
    if (elapsedSec < 60) return `${elapsedSec}s ago`;
    return `${Math.floor(elapsedSec / 60)}m ago`;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-400" />
            Worker Fleet Telemetry & Heartbeats
          </h3>
          <p className="text-xs text-slate-400">
            {workers.length} active process {workers.length === 1 ? 'node' : 'nodes'} reporting distributed telemetry
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh Fleet
        </button>
      </div>

      {isLoading && workers.length === 0 ? (
        <div className="py-8 text-center text-slate-400 text-sm">
          Loading worker fleet status...
        </div>
      ) : workers.length === 0 ? (
        <div className="py-8 text-center text-slate-500 text-sm">
          No worker instances detected in fleet registry.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workers.map((w) => (
            <div
              key={w.workerId}
              className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-xl flex flex-col justify-between hover:border-slate-700 transition space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-white truncate max-w-[180px]">
                    {w.workerId}
                  </h4>
                  <p className="text-xs text-slate-400">
                    {w.hostname} • PID: {w.pid}
                  </p>
                </div>
                {getStatusBadge(w.status)}
              </div>

              {/* Resource Metrics */}
              <div className="grid grid-cols-2 gap-2 py-2 border-y border-slate-800/60 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span>CPU: {w.systemMetrics?.cpuPercent ?? 0}%</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <HardDrive className="w-4 h-4 text-purple-400" />
                  <span>RSS: {formatBytes(w.systemMetrics?.rssMemoryBytes)}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300 col-span-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>
                    Capacity: {w.activeJobCount} / {w.concurrency} concurrent slots
                  </span>
                </div>
              </div>

              {/* Subscribed Queues & Heartbeat */}
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="truncate max-w-[140px]" title={w.queuesSubscribed?.join(', ')}>
                  Queues: {w.queuesSubscribed?.join(', ') || 'default'}
                </span>
                <span>Heartbeat: {formatElapsed(w.lastHeartbeat)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
