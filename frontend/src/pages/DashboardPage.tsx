import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Navbar } from '../components/layout/Navbar';
import { JobList } from '../components/jobs/JobList';
import { QueueMetricsChart } from '../components/observability/QueueMetricsChart';
import { WorkerFleetCard } from '../components/observability/WorkerFleetCard';
import { queueService, QueueListItem } from '../services/queue.service';
import { workerService } from '../services/worker.service';
import { WorkerResponse, SocketEventName, QueueTelemetryPayload, WorkerTelemetryPayload, UserRole } from '@taskflow/shared';
import { Shield, Clock, Key, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [queues, setQueues] = useState<QueueListItem[]>([]);
  const [workers, setWorkers] = useState<WorkerResponse[]>([]);
  const [isObservabilityLoading, setIsObservabilityLoading] = useState<boolean>(true);

  const fetchObservabilityData = useCallback(async () => {
    try {
      const [queueData, workerData] = await Promise.all([
        queueService.listQueues().catch(() => []),
        workerService.listWorkers().catch(() => []),
      ]);
      setQueues(queueData);
      setWorkers(workerData);
    } catch {
      // Squelch errors for smooth background polling
    } finally {
      setIsObservabilityLoading(false);
    }
  }, []);

  const { socket, isConnected } = useSocket();

  useEffect(() => {
    if (user?.role === UserRole.ADMIN && isConnected) {
      socket.subscribeAdminTelemetry();
    }
  }, [user?.role, isConnected, socket]);

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

  useEffect(() => {
    fetchObservabilityData();
    const interval = setInterval(fetchObservabilityData, 10000);
    return () => clearInterval(interval);
  }, [fetchObservabilityData]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Welcome Banner */}
        <div className="p-8 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl shadow-2xl relative overflow-hidden">
          <div className="relative z-10">
            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold uppercase tracking-wider rounded-full inline-block mb-3">
              Milestone 4 Active • Production Observability & Fleet Telemetry
            </span>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Welcome back, {user?.name}
            </h1>
            <p className="mt-2 text-sm text-slate-400 max-w-2xl">
              You are authenticated as <span className="text-white font-semibold">{user?.email}</span> with{' '}
              <span className="text-indigo-400 font-semibold uppercase">{user?.role}</span> permissions. Submit background jobs, track real-time queue states, and manage execution lifecycles below.
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
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Queue Infrastructure</h3>
            </div>
            <div className="text-2xl font-bold text-white">BullMQ + Redis</div>
            <p className="text-xs text-slate-500 mt-2">
              Lock Renewal: 30s • Stalled Watchdog: 15s • Heartbeat: 15s
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
              {user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Active Session'}
            </div>
            <p className="text-xs text-slate-500 mt-2">Member Since: {new Date(user?.createdAt || Date.now()).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Milestone 4: Operational Observability Section */}
        <section className="space-y-6">
          <QueueMetricsChart queues={queues} isLoading={isObservabilityLoading} />
          <WorkerFleetCard
            workers={workers}
            isLoading={isObservabilityLoading}
            onRefresh={fetchObservabilityData}
          />
        </section>

        {/* Live Background Jobs Queue Section */}
        <section>
          <JobList />
        </section>

        {/* Telemetry Quick Link */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-emerald-600/20 text-emerald-400 rounded-xl">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Infrastructure Health Probes</h3>
              <p className="text-xs text-slate-400">
                Monitor MongoDB connectivity, Redis latency, memory footprint, and process uptime.
              </p>
            </div>
          </div>
          <Link
            to="/health"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition"
          >
            Telemetry Probes →
          </Link>
        </div>
      </main>
    </div>
  );
};
