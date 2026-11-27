import React, { useEffect, useState, useCallback } from 'react';
import { workerService, WorkerDetailResponse } from '../services/worker.service';
import { useSocket } from '../context/SocketContext';
import {
  WorkerResponse,
  WorkerStatus,
  SocketEventName,
  WorkerTelemetryPayload,
} from '@taskflow/shared';
import {
  Server,
  RefreshCw,
  Cpu,
  HardDrive,
  Activity,
  AlertTriangle,
  XCircle,
  Eye,
  X,
  Loader2,
} from 'lucide-react';

export const WorkersPage: React.FC = () => {
  const { socket } = useSocket();
  const [workers, setWorkers] = useState<WorkerResponse[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Worker detail modal
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [workerDetail, setWorkerDetail] = useState<WorkerDetailResponse | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState<boolean>(false);

  const fetchWorkers = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await workerService.listWorkers();
      setWorkers(data);
    } catch {
      // Squelch background polling errors
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 10000);
    return () => clearInterval(interval);
  }, [fetchWorkers]);

  // Real-time worker socket events
  useEffect(() => {
    const handleWorkerTelemetry = () => {
      workerService.listWorkers().then(setWorkers).catch(() => {});
    };

    socket.on<WorkerTelemetryPayload>(SocketEventName.WORKER_REGISTERED, handleWorkerTelemetry);
    socket.on<WorkerTelemetryPayload>(SocketEventName.WORKER_HEARTBEAT, handleWorkerTelemetry);
    socket.on<WorkerTelemetryPayload>(SocketEventName.WORKER_STATUS, handleWorkerTelemetry);
    socket.on<WorkerTelemetryPayload>(SocketEventName.WORKER_UNREGISTERED, handleWorkerTelemetry);

    return () => {
      socket.off<WorkerTelemetryPayload>(SocketEventName.WORKER_REGISTERED, handleWorkerTelemetry);
      socket.off<WorkerTelemetryPayload>(SocketEventName.WORKER_HEARTBEAT, handleWorkerTelemetry);
      socket.off<WorkerTelemetryPayload>(SocketEventName.WORKER_STATUS, handleWorkerTelemetry);
      socket.off<WorkerTelemetryPayload>(SocketEventName.WORKER_UNREGISTERED, handleWorkerTelemetry);
    };
  }, [socket]);

  const handleOpenWorkerDetail = async (workerId: string) => {
    setSelectedWorkerId(workerId);
    setIsDetailLoading(true);
    try {
      const detail = await workerService.getWorkerById(workerId);
      setWorkerDetail(detail);
    } catch {
      // Error handling
    } finally {
      setIsDetailLoading(false);
    }
  };

  const getStatusBadge = (status: WorkerStatus, lastHeartbeatIso: string) => {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - new Date(lastHeartbeatIso).getTime()) / 1000));
    const isStale = elapsedSec > 30;

    if (isStale || status === WorkerStatus.DEAD) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <XCircle className="w-3.5 h-3.5" />
          Dead / Stale ({elapsedSec}s)
        </span>
      );
    }

    if (status === WorkerStatus.DEGRADED || elapsedSec > 15) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <AlertTriangle className="w-3.5 h-3.5" />
          Degraded ({elapsedSec}s)
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Healthy ({elapsedSec}s)
      </span>
    );
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Server className="w-6 h-6 text-indigo-400" />
            Worker Fleet Monitoring & Topology
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time process nodes reporting cluster heartbeats, CPU/memory telemetry, and active job executions.
          </p>
        </div>

        <button
          onClick={fetchWorkers}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold transition self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
          <span>Refresh Fleet</span>
        </button>
      </div>

      {/* Fleet Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <div className="text-xs font-semibold text-slate-400 mb-1">Total Discovered Nodes</div>
          <div className="text-3xl font-extrabold text-white">{workers.length}</div>
          <div className="text-xs text-slate-500 mt-1">Autonomous processes</div>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <div className="text-xs font-semibold text-emerald-400 mb-1">Healthy Nodes</div>
          <div className="text-3xl font-extrabold text-white">
            {workers.filter((w) => w.status === WorkerStatus.HEALTHY).length}
          </div>
          <div className="text-xs text-slate-500 mt-1">Heartbeat &lt; 15s</div>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <div className="text-xs font-semibold text-indigo-400 mb-1">Fleet Concurrency Limit</div>
          <div className="text-3xl font-extrabold text-white">
            {workers.reduce((acc, w) => acc + w.concurrency, 0)}
          </div>
          <div className="text-xs text-slate-500 mt-1">Parallel worker slots</div>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <div className="text-xs font-semibold text-blue-400 mb-1">Active Lock Volume</div>
          <div className="text-3xl font-extrabold text-white">
            {workers.reduce((acc, w) => acc + w.activeJobCount, 0)}
          </div>
          <div className="text-xs text-slate-500 mt-1">In-flight processing</div>
        </div>
      </div>

      {/* Worker Fleet Grid */}
      {isLoading && workers.length === 0 ? (
        <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          <span className="text-sm">Polling worker fleet heartbeats...</span>
        </div>
      ) : workers.length === 0 ? (
        <div className="p-12 text-center text-slate-500 bg-slate-900 border border-slate-800 rounded-2xl">
          <Server className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <p className="text-base font-semibold text-white">No active worker processes detected</p>
          <p className="text-xs text-slate-400 mt-1">
            Start a background worker process using <code className="text-indigo-300 font-mono">npm run dev:worker</code> to begin executing jobs.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {workers.map((worker) => (
            <div
              key={worker.workerId}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-6 shadow-xl flex flex-col justify-between transition-all space-y-4"
            >
              <div>
                {/* Worker Header */}
                <div className="flex items-start justify-between pb-3 border-b border-slate-800">
                  <div className="min-w-0 pr-2">
                    <h3 className="text-base font-bold text-white truncate" title={worker.workerId}>
                      {worker.workerId}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Host: {worker.hostname} • PID: {worker.pid}
                    </p>
                  </div>
                  {getStatusBadge(worker.status, worker.lastHeartbeat)}
                </div>

                {/* Subscribed Queues */}
                <div className="mt-3">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    Subscribed Queues
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {worker.queuesSubscribed.map((q) => (
                      <span
                        key={q}
                        className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-slate-300 text-[11px] font-medium"
                      >
                        {q}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Concurrency & Active Jobs */}
                <div className="grid grid-cols-2 gap-3 mt-4 p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase block">Concurrency</span>
                    <span className="text-base font-bold text-white">{worker.concurrency}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase block">Active Jobs</span>
                    <span className="text-base font-bold text-indigo-400">
                      {worker.activeJobCount}
                    </span>
                  </div>
                </div>

                {/* System Metrics */}
                {worker.systemMetrics && (
                  <div className="mt-3 space-y-1.5 text-xs text-slate-400">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                        RSS Memory
                      </span>
                      <span className="font-mono text-slate-200">
                        {formatBytes(worker.systemMetrics.rssMemoryBytes)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-slate-500" />
                        Heap Used
                      </span>
                      <span className="font-mono text-slate-200">
                        {formatBytes(worker.systemMetrics.heapUsedBytes)}
                      </span>
                    </div>

                    {worker.systemMetrics.cpuPercent !== undefined && (
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-slate-500" />
                          CPU Usage
                        </span>
                        <span className="font-mono text-slate-200">
                          {worker.systemMetrics.cpuPercent.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Footer & Detail Button */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400 text-[11px]">
                  Last beat {formatElapsed(worker.lastHeartbeat)}
                </span>
                <button
                  onClick={() => handleOpenWorkerDetail(worker.workerId)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Inspect</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Worker Detail Modal */}
      {selectedWorkerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-indigo-400" />
                Worker Telemetry Inspector
              </h3>
              <button
                onClick={() => {
                  setSelectedWorkerId(null);
                  setWorkerDetail(null);
                }}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isDetailLoading ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                <span className="text-xs">Inspecting worker active locks...</span>
              </div>
            ) : workerDetail ? (
              <div className="space-y-4 text-xs">
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Worker ID:</span>
                    <span className="font-mono text-slate-200">{workerDetail.workerId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Hostname / PID:</span>
                    <span className="text-slate-200">
                      {workerDetail.hostname} (PID {workerDetail.pid})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Uptime:</span>
                    <span className="text-slate-200">
                      {Math.floor(workerDetail.uptimeSeconds / 60)} minutes (
                      {workerDetail.uptimeSeconds}s)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Concurrency:</span>
                    <span className="text-slate-200">{workerDetail.concurrency} concurrent slots</span>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-300 mb-2">
                    Currently Executing Jobs ({workerDetail.currentJobs?.length || 0})
                  </h4>
                  {!workerDetail.currentJobs || workerDetail.currentJobs.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 bg-slate-950/60 rounded-xl border border-slate-800">
                      Worker is currently idle; no jobs locked.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {workerDetail.currentJobs.map((j) => (
                        <div
                          key={j.jobId}
                          className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between"
                        >
                          <div>
                            <p className="font-semibold text-white">{j.name}</p>
                            <p className="font-mono text-[10px] text-slate-400">{j.jobId}</p>
                          </div>
                          <span className="text-[11px] text-indigo-400 font-mono">
                            {(j.elapsedMs / 1000).toFixed(1)}s elapsed
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-rose-400">Failed to load worker diagnostics.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};