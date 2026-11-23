import React, { useState, useEffect } from 'react';
import { JobRecord, jobApiService } from '../../services/job.service';
import { JobStatus } from '@taskflow/shared';
import { useJobEvents } from '../../hooks/useJobEvents';
import {
  X,
  RotateCcw,
  Ban,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Layers,
  Terminal,
} from 'lucide-react';

interface JobDetailModalProps {
  job: JobRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onJobUpdated: (updatedJob: JobRecord) => void;
}

export const JobDetailModal: React.FC<JobDetailModalProps> = ({
  job,
  isOpen,
  onClose,
  onJobUpdated,
}) => {
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveLogs, setLiveLogs] = useState<Array<{ timestamp: string; message: string; level: string }>>([]);

  const { progress: liveProgress, status: liveStatus, progressMessage } = useJobEvents({
    jobId: isOpen && job ? job.jobId : undefined,
    onProgress: (pct, msg) => {
      if (msg) {
        setLiveLogs((prev) => [
          ...prev,
          { timestamp: new Date().toISOString(), message: msg, level: 'info' },
        ]);
      }
      if (job) {
        onJobUpdated({
          ...job,
          progress: pct,
        });
      }
    },
    onStatusChange: (newStatus, payload) => {
      if (job) {
        onJobUpdated({
          ...job,
          status: newStatus,
          progress: payload.progress !== undefined ? payload.progress : job.progress,
          result: payload.result || job.result,
          error: payload.error ? { message: payload.error.message } : job.error,
        });
      }
    },
  });

  // Reset live logs when modal opens for a different job
  useEffect(() => {
    setLiveLogs([]);
  }, [job?.jobId]);

  if (!isOpen || !job) return null;

  const currentStatus = liveStatus || job.status;
  const currentProgress = liveProgress !== null ? liveProgress : job.progress;

  const handleCancel = async () => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      const updated = await jobApiService.cancelJob(job.id, 'Cancelled via TaskFlow Dashboard');
      onJobUpdated(updated);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel job');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRetry = async () => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      const updated = await jobApiService.retryJob(job.id);
      onJobUpdated(updated);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to retry job');
    } finally {
      setIsActionLoading(false);
    }
  };

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case JobStatus.COMPLETED:
        return 'bg-emerald-950 text-emerald-400 border-emerald-800';
      case JobStatus.PROCESSING:
        return 'bg-indigo-950 text-indigo-400 border-indigo-800 animate-pulse';
      case JobStatus.QUEUED:
        return 'bg-sky-950 text-sky-400 border-sky-800';
      case JobStatus.DELAYED:
        return 'bg-amber-950 text-amber-400 border-amber-800';
      case JobStatus.FAILED:
      case JobStatus.DEAD_LETTER:
        return 'bg-rose-950 text-rose-400 border-rose-800';
      case JobStatus.RETRYING:
        return 'bg-orange-950 text-orange-400 border-orange-800';
      case JobStatus.CANCELLED:
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  const getPriorityLabel = (priority: number) => {
    if (priority <= 1) return { label: 'P1 Critical', color: 'text-rose-400' };
    if (priority <= 3) return { label: `P${priority} High`, color: 'text-amber-400' };
    if (priority <= 6) return { label: `P${priority} Normal`, color: 'text-sky-400' };
    return { label: `P${priority} Low`, color: 'text-slate-400' };
  };

  const canCancel = [
    JobStatus.PENDING,
    JobStatus.QUEUED,
    JobStatus.DELAYED,
    JobStatus.PROCESSING,
    JobStatus.RETRYING,
  ].includes(job.status);

  const canRetry = [JobStatus.FAILED, JobStatus.DEAD_LETTER].includes(job.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800 flex items-start justify-between bg-slate-900/95 sticky top-0 z-10">
          <div>
            <div className="flex items-center space-x-3 mb-1.5">
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(
                  currentStatus
                )}`}
              >
                {currentStatus}
              </span>
              <span className={`text-xs font-bold ${getPriorityLabel(job.priority).color}`}>
                {getPriorityLabel(job.priority).label}
              </span>
              <span className="text-xs text-slate-500 font-mono">Queue: {job.queueName}</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">{job.name}</h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">ID: {job.jobId}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 flex-1">
          {actionError && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
              {actionError}
            </div>
          )}

          {/* Progress Bar */}
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-1.5">
              <span>Execution Progress</span>
              <span className="text-white font-mono">{currentProgress}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-300 ${
                  currentStatus === JobStatus.COMPLETED
                    ? 'bg-emerald-500'
                    : currentStatus === JobStatus.FAILED || currentStatus === JobStatus.DEAD_LETTER
                    ? 'bg-rose-500'
                    : 'bg-indigo-500'
                }`}
                style={{ width: `${currentProgress}%` }}
              />
            </div>
            {progressMessage && (
              <div className="text-[11px] text-slate-400 font-mono mt-1 italic">
                {progressMessage}
              </div>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-950/60 border border-slate-800/80 rounded-xl text-xs">
            <div>
              <div className="text-slate-500 uppercase font-semibold">Type</div>
              <div className="text-slate-200 font-medium mt-1 truncate">{job.type}</div>
            </div>
            <div>
              <div className="text-slate-500 uppercase font-semibold">Attempts</div>
              <div className="text-slate-200 font-medium mt-1">
                {job.attemptsMade} / {job.maxAttempts}
              </div>
            </div>
            <div>
              <div className="text-slate-500 uppercase font-semibold">Created</div>
              <div className="text-slate-200 font-medium mt-1">
                {new Date(job.createdAt).toLocaleTimeString()}
              </div>
            </div>
            <div>
              <div className="text-slate-500 uppercase font-semibold">BullMQ ID</div>
              <div className="text-slate-200 font-mono mt-1 truncate">
                {job.bullJobId || 'Not enqueued'}
              </div>
            </div>
          </div>

          {/* Error Trace if Failed */}
          {job.error && (
            <div className="p-4 bg-rose-950/20 border border-rose-900/50 rounded-xl">
              <div className="flex items-center space-x-2 text-rose-400 font-bold text-xs uppercase tracking-wider mb-2">
                <AlertTriangle className="w-4 h-4" />
                <span>Error Diagnostics</span>
              </div>
              <div className="text-xs text-rose-300 font-mono bg-black/40 p-3 rounded-lg overflow-x-auto">
                <div className="font-bold mb-1">{job.error.message}</div>
                {job.error.stack && (
                  <pre className="text-[11px] text-rose-400/80 whitespace-pre-wrap">
                    {job.error.stack}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Execution Result */}
          {job.result && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Processing Result</span>
              </div>
              <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto max-h-48">
                {JSON.stringify(job.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Payload Viewer */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center space-x-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>Job Payload</span>
            </div>
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 overflow-x-auto max-h-40">
              {JSON.stringify(job.payload, null, 2)}
            </pre>
          </div>

          {/* Live Streaming Logs */}
          {liveLogs.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center space-x-2">
                <span className="relative flex h-2 w-2 mr-0.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-400 font-bold">Live Streamed Events ({liveLogs.length})</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[11px] space-y-1.5 max-h-40 overflow-y-auto">
                {liveLogs.map((log, idx) => (
                  <div key={idx} className="flex items-center space-x-2 text-slate-300">
                    <span className="text-slate-500 text-[10px]">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-emerald-400 font-semibold">[STREAM]</span>
                    <span>{log.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Execution History */}
          {job.executions && job.executions.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-purple-400" />
                <span>Execution Attempts History ({job.executions.length})</span>
              </div>
              <div className="space-y-3">
                {job.executions.map((exec, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white">Attempt #{exec.attemptNumber}</span>
                        <span className="text-slate-500 font-mono">({exec.workerId})</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        {exec.durationMs && (
                          <span className="text-slate-400 font-mono">{exec.durationMs}ms</span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            exec.status === 'COMPLETED'
                              ? 'bg-emerald-950 text-emerald-400'
                              : 'bg-rose-950 text-rose-400'
                          }`}
                        >
                          {exec.status}
                        </span>
                      </div>
                    </div>
                    {exec.logs && exec.logs.length > 0 && (
                      <div className="bg-slate-900/80 p-2.5 rounded-lg font-mono text-[11px] space-y-1 text-slate-400">
                        {exec.logs.map((log, lIdx) => (
                          <div key={lIdx} className="flex space-x-2">
                            <span className="text-slate-600">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span
                              className={
                                log.level === 'error'
                                  ? 'text-rose-400'
                                  : log.level === 'warn'
                                  ? 'text-amber-400'
                                  : 'text-slate-300'
                              }
                            >
                              [{log.level.toUpperCase()}] {log.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="p-6 border-t border-slate-800 flex items-center justify-between bg-slate-900 sticky bottom-0">
          <div className="text-xs text-slate-500">
            {job.lockedBy && <span>Locked by: {job.lockedBy}</span>}
          </div>
          <div className="flex items-center space-x-3">
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={isActionLoading}
                className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                {isActionLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Ban className="w-3.5 h-3.5" />
                )}
                <span>Cancel Job</span>
              </button>
            )}

            {canRetry && (
              <button
                onClick={handleRetry}
                disabled={isActionLoading}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                {isActionLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                <span>Retry Job</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
