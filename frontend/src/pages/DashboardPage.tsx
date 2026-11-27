import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useJobEvents } from '../hooks/useJobEvents';
import { queueService, QueueListItem } from '../services/queue.service';
import { workerService } from '../services/worker.service';
import { jobApiService, JobRecord } from '../services/job.service';
import { QueueMetricsChart } from '../components/observability/QueueMetricsChart';
import { WorkerFleetCard } from '../components/observability/WorkerFleetCard';
import {
  WorkerResponse,
  SocketEventName,
  QueueTelemetryPayload,
  WorkerTelemetryPayload,
  UserRole,
  JobStatus,
  WorkerStatus,
} from '@taskflow/shared';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  RotateCcw,
  AlertOctagon,
  Server,
  Activity,
  ArrowRight,
  TrendingUp,
  Inbox,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';

interface RecentEvent {
  id: string;
  jobId: string;
  type: string;
  status: JobStatus;
  progress?: number;
  message?: string;
  timestamp: string;
}

const STATUS_PALETTE: Record<JobStatus, string> = {
  [JobStatus.COMPLETED]: '#10b981', // emerald-500
  [JobStatus.PROCESSING]: '#3b82f6', // blue-500
  [JobStatus.QUEUED]: '#6366f1', // indigo-500
  [JobStatus.PENDING]: '#f59e0b', // amber-500
  [JobStatus.DELAYED]: '#eab308', // yellow-500
  [JobStatus.FAILED]: '#ef4444', // red-500
  [JobStatus.RETRYING]: '#a855f7', // purple-500
  [JobStatus.DEAD_LETTER]: '#f97316', // orange-500
  [JobStatus.CANCELLED]: '#64748b', // slate-500
};

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { socket, isConnected } = useSocket();

  const [queues, setQueues] = useState<QueueListItem[]>([]);
  const [workers, setWorkers] = useState<WorkerResponse[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [dlqTotal, setDlqTotal] = useState<number>(0);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initial fetch of authoritative metrics
  const fetchOverviewData = useCallback(async () => {
    try {
      const [queueData, workerData, jobData, dlqData] = await Promise.all([
        queueService.listQueues().catch(() => []),
        workerService.listWorkers().catch(() => []),
        jobApiService.listJobs({ limit: 100 }).catch(() => ({ data: [] })),
        jobApiService.getDlqStats().catch(() => ({ totalDeadLetters: 0 })),
      ]);

      setQueues(queueData);
      setWorkers(workerData);
      setJobs(jobData.data || []);
      setDlqTotal(dlqData.totalDeadLetters || 0);
    } catch {
      // Squelch errors for smooth polling
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverviewData();
    const interval = setInterval(fetchOverviewData, 15000);
    return () => clearInterval(interval);
  }, [fetchOverviewData]);

  // Admin telemetry subscription
  useEffect(() => {
    if (user?.role === UserRole.ADMIN && isConnected) {
      socket.subscribeAdminTelemetry();
    }
  }, [user?.role, isConnected, socket]);

  // Real-time Queue & Worker Telemetry
  useEffect(() => {
    const handleQueueTelemetry = (envelope: { data: QueueTelemetryPayload }) => {
      const qData = envelope.data;
      setQueues((prev) =>
        prev.map((q) =>
          q.name === qData.queueName
            ? {
                ...q,
                jobCounts: {
                  waiting: qData.waiting,
                  active: qData.active,
                  delayed: qData.delayed,
                  failed: qData.failed,
                  completed: qData.completed,
                },
              }
            : q
        )
      );
    };

    const handleWorkerTelemetry = () => {
      workerService.listWorkers().then(setWorkers).catch(() => {});
    };

    socket.on<QueueTelemetryPayload>(SocketEventName.QUEUE_STATS, handleQueueTelemetry);
    socket.on<WorkerTelemetryPayload>(SocketEventName.WORKER_HEARTBEAT, handleWorkerTelemetry);
    socket.on<WorkerTelemetryPayload>(SocketEventName.WORKER_REGISTERED, handleWorkerTelemetry);
    socket.on<WorkerTelemetryPayload>(SocketEventName.WORKER_STATUS, handleWorkerTelemetry);
    socket.on<WorkerTelemetryPayload>(SocketEventName.WORKER_UNREGISTERED, handleWorkerTelemetry);

    return () => {
      socket.off<QueueTelemetryPayload>(SocketEventName.QUEUE_STATS, handleQueueTelemetry);
      socket.off<WorkerTelemetryPayload>(SocketEventName.WORKER_HEARTBEAT, handleWorkerTelemetry);
      socket.off<WorkerTelemetryPayload>(SocketEventName.WORKER_REGISTERED, handleWorkerTelemetry);
      socket.off<WorkerTelemetryPayload>(SocketEventName.WORKER_STATUS, handleWorkerTelemetry);
      socket.off<WorkerTelemetryPayload>(SocketEventName.WORKER_UNREGISTERED, handleWorkerTelemetry);
    };
  }, [socket]);

  // Live Job Event Listener for Recent Activity stream & in-memory stats update
  useJobEvents({
    onEvent: (envelope) => {
      const data = envelope.data;
      if (!data || !('jobId' in data)) return;

      const newEvent: RecentEvent = {
        id: envelope.eventId || `${Date.now()}-${Math.random()}`,
        jobId: data.jobId,
        type: ('type' in data && data.type) ? data.type : 'JOB',
        status: ('status' in data && data.status) ? data.status : JobStatus.PROCESSING,
        progress: ('progress' in data) ? data.progress : undefined,
        message: ('progressMessage' in data) ? data.progressMessage : undefined,
        timestamp: envelope.timestamp || new Date().toISOString(),
      };

      setRecentEvents((prev) => [newEvent, ...prev.slice(0, 19)]);

      // Update in-memory job status if present in state
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.jobId === data.jobId || j.id === data.jobId);
        if (idx !== -1) {
          const updated = { ...prev[idx] };
          if ('status' in data && data.status) updated.status = data.status;
          if ('progress' in data && data.progress !== undefined) updated.progress = data.progress;
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return prev;
      });
    },
  });

  // Calculate high-level KPIs from Authoritative Job List
  const stats = useMemo(() => {
    let pending = 0;
    let queued = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    let retrying = 0;
    let deadLetter = dlqTotal;
    let cancelled = 0;

    jobs.forEach((j) => {
      switch (j.status) {
        case JobStatus.PENDING:
          pending++;
          break;
        case JobStatus.QUEUED:
          queued++;
          break;
        case JobStatus.PROCESSING:
          processing++;
          break;
        case JobStatus.COMPLETED:
          completed++;
          break;
        case JobStatus.FAILED:
          failed++;
          break;
        case JobStatus.RETRYING:
          retrying++;
          break;
        case JobStatus.DEAD_LETTER:
          // Keep dlq count from dlqStats endpoint
          break;
        case JobStatus.CANCELLED:
          cancelled++;
          break;
      }
    });

    return {
      total: jobs.length,
      pending,
      queued,
      processing,
      completed,
      failed,
      retrying,
      deadLetter,
      cancelled,
    };
  }, [jobs, dlqTotal]);

  const activeWorkerCount = useMemo(() => {
    return workers.filter((w) => w.status === WorkerStatus.HEALTHY).length;
  }, [workers]);

  // Job Status Distribution Data for Recharts Pie
  const statusPieData = useMemo(() => {
    const data = [
      { name: 'Completed', value: stats.completed, color: STATUS_PALETTE[JobStatus.COMPLETED] },
      { name: 'Processing', value: stats.processing, color: STATUS_PALETTE[JobStatus.PROCESSING] },
      { name: 'Queued', value: stats.queued, color: STATUS_PALETTE[JobStatus.QUEUED] },
      { name: 'Failed', value: stats.failed, color: STATUS_PALETTE[JobStatus.FAILED] },
      { name: 'Retrying', value: stats.retrying, color: STATUS_PALETTE[JobStatus.RETRYING] },
      { name: 'Dead-Letter', value: stats.deadLetter, color: STATUS_PALETTE[JobStatus.DEAD_LETTER] },
    ].filter((item) => item.value > 0);

    return data;
  }, [stats]);

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="p-6 sm:p-8 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold rounded-full inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Cluster Operational
              </span>
              <span className="text-xs text-slate-400">
                Connected as <span className="text-slate-200 font-semibold">{user?.email}</span>
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Mission Control Overview
            </h1>
            <p className="mt-1 text-sm text-slate-400 max-w-2xl">
              Real-time telemetry, queue backlogs, fleet worker health, and distributed background processing status.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/jobs"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center gap-2"
            >
              <span>Manage Jobs</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Primary KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
        {/* Total Jobs */}
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Total Jobs
          </div>
          <div className="text-2xl font-bold text-white">{stats.total}</div>
          <div className="text-[10px] text-slate-500 mt-1">MongoDB Records</div>
        </div>

        {/* Completed */}
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 mb-1 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </div>
          <div className="text-2xl font-bold text-white">{stats.completed}</div>
          <div className="text-[10px] text-emerald-500/80 mt-1">Terminal Success</div>
        </div>

        {/* Processing */}
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-400 mb-1 flex items-center gap-1">
            <Play className="w-3.5 h-3.5" />
            Active
          </div>
          <div className="text-2xl font-bold text-white">{stats.processing}</div>
          <div className="text-[10px] text-blue-500/80 mt-1">In-Flight Lock</div>
        </div>

        {/* Queued / Waiting */}
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400 mb-1 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Queued
          </div>
          <div className="text-2xl font-bold text-white">{stats.queued}</div>
          <div className="text-[10px] text-indigo-500/80 mt-1">Awaiting Worker</div>
        </div>

        {/* Retrying */}
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-400 mb-1 flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5" />
            Retrying
          </div>
          <div className="text-2xl font-bold text-white">{stats.retrying}</div>
          <div className="text-[10px] text-purple-500/80 mt-1">Exponential Backoff</div>
        </div>

        {/* Failed */}
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-400 mb-1 flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5" />
            Failed
          </div>
          <div className="text-2xl font-bold text-white">{stats.failed}</div>
          <div className="text-[10px] text-rose-500/80 mt-1">Terminal Error</div>
        </div>

        {/* Dead Letter */}
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-orange-400 mb-1 flex items-center gap-1">
            <AlertOctagon className="w-3.5 h-3.5" />
            DLQ
          </div>
          <div className="text-2xl font-bold text-white">{stats.deadLetter}</div>
          <div className="text-[10px] text-orange-500/80 mt-1">Exhausted Retries</div>
        </div>

        {/* Fleet Workers */}
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400 mb-1 flex items-center gap-1">
            <Server className="w-3.5 h-3.5" />
            Workers
          </div>
          <div className="text-2xl font-bold text-white">
            {activeWorkerCount}
            <span className="text-xs font-normal text-slate-400">/{workers.length}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Healthy Fleet Nodes</div>
        </div>
      </div>

      {/* Observability Visualizations: Queue Backlog & State Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <QueueMetricsChart queues={queues} isLoading={isLoading} />
        </div>

        {/* Status Distribution Donut Chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-400" />
                Job Status Distribution
              </h3>
              <span className="text-[10px] text-slate-400">
                {jobs.length} Sampled
              </span>
            </div>

            {statusPieData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-xs text-slate-500">
                No job metrics available
              </div>
            ) : (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                    >
                      {statusPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#1e293b',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                        color: '#f8fafc',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-3 border-t border-slate-800">
            {statusPieData.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-slate-400">{item.name}</span>
                </div>
                <span className="font-semibold text-slate-200">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Section: Worker Fleet & Live Activity Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Worker Fleet Status */}
        <div className="lg:col-span-2">
          <WorkerFleetCard
            workers={workers}
            isLoading={isLoading}
            onRefresh={fetchOverviewData}
          />
        </div>

        {/* Real-time Activity Feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl flex flex-col h-[400px]">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 flex-shrink-0">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Live Telemetry Stream
            </h3>
            <span className="text-[10px] text-emerald-400 uppercase font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Streaming
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs">
            {recentEvents.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
                <Inbox className="w-8 h-8 opacity-40" />
                <p>Awaiting live Socket.io events...</p>
                <p className="text-[10px] text-slate-400">
                  New job lifecycle transitions stream here in real-time.
                </p>
              </div>
            ) : (
              recentEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="p-2.5 bg-slate-950/60 border border-slate-800/80 rounded-lg flex items-start justify-between gap-2 hover:border-slate-700 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor:
                            STATUS_PALETTE[evt.status] || '#64748b',
                        }}
                      />
                      <span className="font-semibold text-white truncate">
                        {evt.jobId.slice(0, 16)}...
                      </span>
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                        {evt.status}
                      </span>
                    </div>
                    {evt.message && (
                      <p className="text-[11px] text-slate-400 mt-1 truncate">
                        {evt.message}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 flex-shrink-0">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};