import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { jobApiService, JobRecord } from '../services/job.service';
import { queueService, QueueListItem } from '../services/queue.service';
import { workerService } from '../services/worker.service';
import { WorkerResponse, JobStatus } from '@taskflow/shared';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  Layers,
  Server,
  RefreshCw,
  CheckCircle2,
  Clock,
} from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  Completed: '#10b981',
  Processing: '#3b82f6',
  Queued: '#6366f1',
  Failed: '#ef4444',
  Retrying: '#a855f7',
  'Dead Letter': '#f97316',
  Cancelled: '#64748b',
};

export const AnalyticsPage: React.FC = () => {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [queues, setQueues] = useState<QueueListItem[]>([]);
  const [workers, setWorkers] = useState<WorkerResponse[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);
    try {
      const [jobsRes, queuesRes, workersRes] = await Promise.all([
        jobApiService.listJobs({ limit: 100 }),
        queueService.listQueues(),
        workerService.listWorkers(),
      ]);
      setJobs(jobsRes.data || []);
      setQueues(queuesRes || []);
      setWorkers(workersRes || []);
    } catch {
      // Squelch background errors
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Aggregate Status Distribution
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {
      Completed: 0,
      Processing: 0,
      Queued: 0,
      Failed: 0,
      Retrying: 0,
      'Dead Letter': 0,
      Cancelled: 0,
    };

    jobs.forEach((j) => {
      switch (j.status) {
        case JobStatus.COMPLETED:
          counts.Completed++;
          break;
        case JobStatus.PROCESSING:
          counts.Processing++;
          break;
        case JobStatus.QUEUED:
        case JobStatus.PENDING:
          counts.Queued++;
          break;
        case JobStatus.FAILED:
          counts.Failed++;
          break;
        case JobStatus.RETRYING:
          counts.Retrying++;
          break;
        case JobStatus.DEAD_LETTER:
          counts['Dead Letter']++;
          break;
        case JobStatus.CANCELLED:
          counts.Cancelled++;
          break;
      }
    });

    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .filter((item) => item.value > 0);
  }, [jobs]);

  // Queue Backlog Depth Comparison
  const queueComparisonData = useMemo(() => {
    return queues.map((q) => ({
      name: q.name,
      Waiting: q.jobCounts?.waiting || 0,
      Active: q.jobCounts?.active || 0,
      Failed: q.jobCounts?.failed || 0,
      Completed: q.jobCounts?.completed || 0,
    }));
  }, [queues]);

  // Attempts Breakdown (How many jobs completed in 1st attempt vs 2nd vs 3+)
  const attemptsData = useMemo(() => {
    const buckets: Record<string, number> = {
      '1 Attempt': 0,
      '2 Attempts': 0,
      '3+ Attempts': 0,
    };

    jobs.forEach((j) => {
      const attempts = j.attemptsMade || 1;
      if (attempts === 1) buckets['1 Attempt']++;
      else if (attempts === 2) buckets['2 Attempts']++;
      else buckets['3+ Attempts']++;
    });

    return Object.entries(buckets).map(([name, count]) => ({ name, count }));
  }, [jobs]);

  // Worker Load & Concurrency Distribution
  const workerLoadData = useMemo(() => {
    return workers.map((w) => ({
      workerId: w.workerId.slice(0, 10),
      activeJobs: w.activeJobCount,
      concurrency: w.concurrency,
      cpuPercent: w.systemMetrics?.cpuPercent || 0,
    }));
  }, [workers]);

  // Calculate Success Rate
  const successMetrics = useMemo(() => {
    const terminalCompleted = jobs.filter((j) => j.status === JobStatus.COMPLETED).length;
    const terminalFailed = jobs.filter(
      (j) => j.status === JobStatus.FAILED || j.status === JobStatus.DEAD_LETTER
    ).length;
    const totalTerminal = terminalCompleted + terminalFailed;

    const rate = totalTerminal > 0 ? ((terminalCompleted / totalTerminal) * 100).toFixed(1) : '100.0';

    return {
      rate,
      completed: terminalCompleted,
      failed: terminalFailed,
      total: totalTerminal,
    };
  }, [jobs]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-400" />
            Operational Telemetry & Performance Analytics
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Authoritative metrics derived from live BullMQ queue states, MongoDB job records, and worker heartbeats.
          </p>
        </div>

        <button
          onClick={fetchAnalytics}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
          <span>Refresh Analytics</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
            <span>Terminal Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">{successMetrics.rate}%</div>
          <p className="text-xs text-slate-500 mt-1">
            {successMetrics.completed} succeeded / {successMetrics.total} resolved
          </p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
            <span>Total Sampled Jobs</span>
            <TrendingUp className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">{jobs.length}</div>
          <p className="text-xs text-slate-500 mt-1">
            Across {queues.length} registered {queues.length === 1 ? 'queue' : 'queues'}
          </p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
            <span>Worker Capacity</span>
            <Server className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">
            {workers.reduce((acc, w) => acc + w.concurrency, 0)}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Max concurrency across {workers.length} nodes
          </p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
            <span>Active In-Flight Load</span>
            <Clock className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">
            {workers.reduce((acc, w) => acc + w.activeJobCount, 0)}
          </div>
          <p className="text-xs text-slate-500 mt-1">Simultaneously processing</p>
        </div>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution Chart */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-xl">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white">Job State Distribution</h3>
              <p className="text-xs text-slate-400">Proportional breakdown of all job lifecycles</p>
            </div>
            <span className="text-xs font-semibold text-slate-400">{jobs.length} jobs</span>
          </div>

          <div className="h-64 w-full">
            {statusData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No job metrics available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {statusData.map((entry) => (
                      <Cell
                        key={`status-cell-${entry.name}`}
                        fill={STATUS_COLORS[entry.name] || '#6366f1'}
                      />
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
            )}
          </div>
        </div>

        {/* Queue Backlog Depth Comparison */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-xl">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white">Queue Depth by Lifecycle State</h3>
              <p className="text-xs text-slate-400">Waiting vs Active vs Completed across queues</p>
            </div>
            <Layers className="w-4 h-4 text-indigo-400" />
          </div>

          <div className="h-64 w-full">
            {queueComparisonData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No active queues discovered
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={queueComparisonData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#1e293b',
                      borderRadius: '0.5rem',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="Waiting" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Active" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Retry & Attempt Frequency */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-xl">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white">Execution Attempt Distribution</h3>
              <p className="text-xs text-slate-400">How many attempts were required to resolve jobs</p>
            </div>
            <TrendingUp className="w-4 h-4 text-purple-400" />
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attemptsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#1e293b',
                    borderRadius: '0.5rem',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                />
                <Bar dataKey="count" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Worker Fleet Load */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-xl">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white">Worker Fleet Concurrency Utilization</h3>
              <p className="text-xs text-slate-400">Active jobs against configured worker concurrency limits</p>
            </div>
            <Server className="w-4 h-4 text-emerald-400" />
          </div>

          <div className="h-64 w-full">
            {workerLoadData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No active workers connected
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workerLoadData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="workerId" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#1e293b',
                      borderRadius: '0.5rem',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="activeJobs" name="Active Jobs" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="concurrency" name="Max Concurrency" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};