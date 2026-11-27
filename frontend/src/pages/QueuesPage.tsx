import React, { useEffect, useState, useCallback } from 'react';
import { queueService, QueueListItem } from '../services/queue.service';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import {
  SocketEventName,
  QueueTelemetryPayload,
  UserRole,
  QueueStatistics,
} from '@taskflow/shared';
import {
  Layers,
  RefreshCw,
  Plus,
  X,
  Loader2,
} from 'lucide-react';
import { apiClient } from '../services/api.client';

export const QueuesPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === UserRole.ADMIN;
  const { socket } = useSocket();

  const [queues, setQueues] = useState<QueueListItem[]>([]);
  const [queueStatsMap, setQueueStatsMap] = useState<Record<string, QueueStatistics>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Create Queue Modal (Admin only)
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [newQueueName, setNewQueueName] = useState<string>('');
  const [newQueueDesc, setNewQueueDesc] = useState<string>('');
  const [newQueueConcurrency, setNewQueueConcurrency] = useState<number>(5);
  const [isSubmittingQueue, setIsSubmittingQueue] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchQueues = useCallback(async () => {
    setIsLoading(true);
    try {
      const qList = await queueService.listQueues();
      setQueues(qList);

      // Fetch stats snapshot for each queue
      const statsPromises = qList.map(async (q) => {
        try {
          const stats = await queueService.getQueueStats(q.name);
          return { name: q.name, stats };
        } catch {
          return null;
        }
      });

      const statsResults = await Promise.all(statsPromises);
      const newMap: Record<string, QueueStatistics> = {};
      statsResults.forEach((res) => {
        if (res) newMap[res.name] = res.stats;
      });
      setQueueStatsMap(newMap);
    } catch {
      // Squelch error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 15000);
    return () => clearInterval(interval);
  }, [fetchQueues]);

  // Real-time Queue Stats socket events
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

    socket.on<QueueTelemetryPayload>(SocketEventName.QUEUE_STATS, handleQueueTelemetry);
    return () => {
      socket.off<QueueTelemetryPayload>(SocketEventName.QUEUE_STATS, handleQueueTelemetry);
    };
  }, [socket]);

  const handleCreateQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsSubmittingQueue(true);

    try {
      await apiClient.post('/queues', {
        name: newQueueName.trim().toLowerCase(),
        description: newQueueDesc.trim() || undefined,
        maxConcurrency: Number(newQueueConcurrency) || 5,
      });

      setIsCreateOpen(false);
      setNewQueueName('');
      setNewQueueDesc('');
      fetchQueues();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create queue');
    } finally {
      setIsSubmittingQueue(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6 text-indigo-400" />
            Distributed Queue Monitoring
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time BullMQ queue depth, concurrency limits, 60-second throughput, and backlog states.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchQueues}
            disabled={isLoading}
            className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl transition"
            title="Refresh queues"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          {isAdmin && (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Create Queue</span>
            </button>
          )}
        </div>
      </div>

      {/* Queue Cards Grid */}
      {isLoading && queues.length === 0 ? (
        <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          <span className="text-sm">Discovering cluster queues...</span>
        </div>
      ) : queues.length === 0 ? (
        <div className="p-12 text-center text-slate-500 bg-slate-900 border border-slate-800 rounded-2xl">
          <Layers className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <p className="text-base font-semibold text-white">No active queues found</p>
          <p className="text-xs text-slate-400 mt-1">
            Queues are automatically registered when background jobs are submitted.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {queues.map((queue) => {
            const stats = queueStatsMap[queue.name];
            const waiting = queue.jobCounts?.waiting || 0;
            const active = queue.jobCounts?.active || 0;
            const completed = queue.jobCounts?.completed || 0;
            const failed = queue.jobCounts?.failed || 0;
            const delayed = queue.jobCounts?.delayed || 0;
            const total = waiting + active + completed + failed + delayed;

            return (
              <div
                key={queue.name}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-6 shadow-xl flex flex-col justify-between transition-all"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between pb-3 mb-4 border-b border-slate-800">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        {queue.name}
                        {stats?.isPaused && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-400 border border-amber-800 text-[10px] font-bold">
                            PAUSED
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {queue.description || 'General background processing queue'}
                      </p>
                    </div>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {queue.maxConcurrency || 5}x Concurrency
                    </span>
                  </div>

                  {/* 60s Throughput & Wait Time pill */}
                  {stats && (
                    <div className="mb-4 grid grid-cols-2 gap-2 p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 block">60s Throughput</span>
                        <span className="font-semibold text-emerald-400">
                          +{stats.throughput?.completedLastMinute || 0}
                        </span>{' '}
                        <span className="text-slate-400">/min</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">Est. Wait Time</span>
                        <span className="font-semibold text-slate-200">
                          {stats.estimatedWaitTimeMs
                            ? `${(stats.estimatedWaitTimeMs / 1000).toFixed(1)}s`
                            : 'Immediate'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Job State Counts */}
                  <div className="grid grid-cols-3 gap-2 text-center mb-4">
                    <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                      <span className="text-[10px] text-amber-400 uppercase font-semibold block">
                        Waiting
                      </span>
                      <span className="text-lg font-bold text-white">{waiting}</span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                      <span className="text-[10px] text-blue-400 uppercase font-semibold block">
                        Active
                      </span>
                      <span className="text-lg font-bold text-white">{active}</span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                      <span className="text-[10px] text-emerald-400 uppercase font-semibold block">
                        Done
                      </span>
                      <span className="text-lg font-bold text-white">{completed}</span>
                    </div>
                  </div>

                  {/* Failed & Delayed Sub-row */}
                  <div className="flex items-center justify-between text-xs text-slate-400 px-1 mb-4">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>Failed: {failed}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-500" />
                      <span>Delayed: {delayed}</span>
                    </div>
                    <div className="text-slate-400 font-medium">Total: {total}</div>
                  </div>

                  {/* Stacked Proportional Bar */}
                  {total > 0 && (
                    <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden flex mb-2">
                      <div
                        className="bg-emerald-500 h-full"
                        style={{ width: `${(completed / total) * 100}%` }}
                        title={`Completed: ${completed}`}
                      />
                      <div
                        className="bg-blue-500 h-full"
                        style={{ width: `${(active / total) * 100}%` }}
                        title={`Active: ${active}`}
                      />
                      <div
                        className="bg-amber-500 h-full"
                        style={{ width: `${(waiting / total) * 100}%` }}
                        title={`Waiting: ${waiting}`}
                      />
                      <div
                        className="bg-rose-500 h-full"
                        style={{ width: `${(failed / total) * 100}%` }}
                        title={`Failed: ${failed}`}
                      />
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Created {new Date(queue.createdAt || Date.now()).toLocaleDateString()}</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live Sync
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Admin Create Queue Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" />
                Initialize New BullMQ Queue
              </h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createError && (
              <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-xs">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateQueue} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Queue Name (Alphanumeric, lowercase)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. notifications, reports, critical"
                  value={newQueueName}
                  onChange={(e) => setNewQueueName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. High-priority notification queue"
                  value={newQueueDesc}
                  onChange={(e) => setNewQueueDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Max Worker Concurrency
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={newQueueConcurrency}
                  onChange={(e) => setNewQueueConcurrency(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingQueue}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center space-x-1.5"
                >
                  {isSubmittingQueue && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Initialize Queue</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};