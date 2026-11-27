import React, { useState, useEffect, useCallback } from 'react';
import { jobApiService, JobRecord } from '../services/job.service';
import { JobStatus, UserRole } from '@taskflow/shared';
import { useAuth } from '../context/AuthContext';
import {
  AlertOctagon,
  RotateCcw,
  Search,
  RefreshCw,
  Eye,
  AlertTriangle,
  Inbox,
  Loader2,
  Copy,
  Check,
  ShieldAlert,
  Layers,
} from 'lucide-react';
import { JobDetailModal } from '../components/jobs/JobDetailModal';

export const DlqPage: React.FC = () => {
  const { user } = useAuth();
  const isViewer = user?.role === UserRole.VIEWER;

  const [dlqJobs, setDlqJobs] = useState<JobRecord[]>([]);
  const [dlqStats, setDlqStats] = useState<{
    totalDeadLetters: number;
    byQueue: Record<string, number>;
  }>({ totalDeadLetters: 0, byQueue: {} });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isBulkRedriving, setIsBulkRedriving] = useState<boolean>(false);
  const [actingJobId, setActingJobId] = useState<string | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Modal inspection
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchDlqData = useCallback(async () => {
    setIsLoading(true);
    setFeedbackMessage(null);
    try {
      const queueParam = selectedQueue === 'ALL' ? undefined : selectedQueue;
      const [statsRes, jobsRes] = await Promise.all([
        jobApiService.getDlqStats().catch(() => ({ totalDeadLetters: 0, byQueue: {} })),
        jobApiService.listJobs({
          page: currentPage,
          limit: 10,
          status: JobStatus.DEAD_LETTER,
          queueName: queueParam,
          search: searchQuery.trim() || undefined,
        }),
      ]);

      setDlqStats(statsRes);
      setDlqJobs(jobsRes.data);
      setTotalPages(jobsRes.pagination.totalPages);
      setTotalItems(jobsRes.pagination.totalItems);
    } catch (err: unknown) {
      setFeedbackMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to fetch DLQ records',
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedQueue, searchQuery, currentPage]);

  useEffect(() => {
    fetchDlqData();
  }, [fetchDlqData]);

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSingleRedrive = async (job: JobRecord) => {
    if (isViewer) return;
    setActingJobId(job.id);
    setFeedbackMessage(null);
    try {
      await jobApiService.retryJob(job.id);
      setFeedbackMessage({
        type: 'success',
        text: `Job ${job.name} successfully re-enqueued for execution.`,
      });
      fetchDlqData();
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to redrive job',
      });
    } finally {
      setActingJobId(null);
    }
  };

  const handleBulkRedrive = async () => {
    if (isViewer) return;
    const targetQueue = selectedQueue === 'ALL' ? undefined : selectedQueue;
    const confirmMsg = targetQueue
      ? `Redrive all dead-letter jobs in queue '${targetQueue}'?`
      : 'Redrive ALL quarantined dead-letter jobs across the cluster?';

    if (!window.confirm(confirmMsg)) return;

    setIsBulkRedriving(true);
    setFeedbackMessage(null);
    try {
      const result = await jobApiService.bulkRedrive(targetQueue);
      setFeedbackMessage({
        type: 'success',
        text: `Successfully re-enqueued ${result.redrivenCount} dead-letter jobs.`,
      });
      fetchDlqData();
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Bulk redrive operation failed',
      });
    } finally {
      setIsBulkRedriving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <AlertOctagon className="w-6 h-6 text-orange-400" />
            Dead Letter Queue (DLQ) Management
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Quarantine area for jobs that have exceeded maximum retry attempts or suffered unrecoverable failures.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchDlqData}
            disabled={isLoading}
            className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl transition"
            title="Refresh DLQ"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-orange-400' : ''}`} />
          </button>

          {isViewer ? (
            <div className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800/60 border border-slate-700 text-slate-400 rounded-xl text-xs font-medium">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span>Read-Only Viewer</span>
            </div>
          ) : (
            <button
              onClick={handleBulkRedrive}
              disabled={isBulkRedriving || dlqStats.totalDeadLetters === 0}
              className="px-4 py-2 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30 rounded-xl text-xs font-semibold transition flex items-center space-x-2 disabled:opacity-40"
            >
              {isBulkRedriving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              <span>Bulk Redrive All ({dlqStats.totalDeadLetters})</span>
            </button>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMessage && (
        <div
          className={`p-4 rounded-xl border text-xs font-medium flex items-center space-x-2 ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
          }`}
        >
          {feedbackMessage.type === 'success' ? (
            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          )}
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      {/* DLQ Summary Breakdown Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
            <span>Total Quarantined Jobs</span>
            <AlertOctagon className="w-4 h-4 text-orange-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">{dlqStats.totalDeadLetters}</div>
          <p className="text-xs text-slate-500 mt-1">Exhausted maximum retry attempts</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl shadow-lg sm:col-span-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
            <span>Queue Breakdown</span>
            <Layers className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {Object.keys(dlqStats.byQueue).length === 0 ? (
              <span className="text-xs text-slate-500">No active dead-letter jobs across queues.</span>
            ) : (
              Object.entries(dlqStats.byQueue).map(([qName, count]) => (
                <div
                  key={qName}
                  className="px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center space-x-2 text-xs"
                >
                  <span className="font-semibold text-slate-300">{qName}:</span>
                  <span className="px-2 py-0.5 rounded-full bg-orange-950/80 text-orange-400 font-bold border border-orange-800/80 text-[11px]">
                    {count}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Search and Queue Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search dead-letter jobs by ID, name, or failure..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-orange-500 transition"
          />
        </div>

        <div className="flex items-center space-x-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-1.5">
          <span className="text-xs text-slate-400">Queue:</span>
          <select
            value={selectedQueue}
            onChange={(e) => {
              setSelectedQueue(e.target.value);
              setCurrentPage(1);
            }}
            className="bg-transparent text-xs text-slate-200 focus:outline-none"
          >
            <option value="ALL" className="bg-slate-900">All Queues</option>
            {Object.keys(dlqStats.byQueue).map((q) => (
              <option key={q} value={q} className="bg-slate-900">
                {q} ({dlqStats.byQueue[q]})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Dead-Letter Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 uppercase font-semibold text-slate-400 border-b border-slate-800 text-[10px] tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Dead-Letter Job</th>
                <th className="py-3.5 px-4">Queue & Type</th>
                <th className="py-3.5 px-4">Failure Reason</th>
                <th className="py-3.5 px-4">Attempts</th>
                <th className="py-3.5 px-4">Quarantine Time</th>
                <th className="py-3.5 px-4 text-right">Redrive Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
              {isLoading && dlqJobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
                      <span>Loading quarantined jobs...</span>
                    </div>
                  </td>
                </tr>
              ) : dlqJobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Inbox className="w-8 h-8 opacity-40 text-emerald-400" />
                      <p className="text-sm font-semibold text-slate-300">
                        DLQ is completely healthy and empty!
                      </p>
                      <p className="text-xs text-slate-400">
                        No jobs currently require manual redrive or investigation.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                dlqJobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() => {
                      setSelectedJob(job);
                      setIsDetailOpen(true);
                    }}
                    className="hover:bg-slate-800/50 cursor-pointer transition"
                  >
                    {/* Job ID & Name */}
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white truncate max-w-[200px]">
                        {job.name}
                      </div>
                      <div className="flex items-center space-x-1.5 mt-1">
                        <span className="font-mono text-[10px] text-slate-400">
                          {job.jobId ? job.jobId.slice(0, 16) : job.id.slice(0, 16)}...
                        </span>
                        <button
                          onClick={(e) => handleCopyId(job.jobId || job.id, e)}
                          className="text-slate-500 hover:text-slate-300 p-0.5 rounded transition"
                          title="Copy ID"
                        >
                          {copiedId === (job.jobId || job.id) ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Queue & Type */}
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-200">{job.queueName}</div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">
                        {job.type}
                      </div>
                    </td>

                    {/* Failure Reason */}
                    <td className="py-3.5 px-4 max-w-xs">
                      <div className="p-2 rounded bg-rose-950/30 border border-rose-900/40 text-rose-300 text-[11px] font-mono truncate">
                        {job.error?.message || 'Exhausted retry budget without resolution'}
                      </div>
                    </td>

                    {/* Attempts */}
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-bold text-[11px]">
                        {job.attemptsMade} / {job.maxAttempts}
                      </span>
                    </td>

                    {/* Quarantine Timestamp */}
                    <td className="py-3.5 px-4 text-[11px] text-slate-400">
                      <div>
                        {job.failedAt
                          ? new Date(job.failedAt).toLocaleTimeString()
                          : new Date(job.updatedAt).toLocaleTimeString()}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(job.failedAt || job.updatedAt).toLocaleDateString()}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedJob(job);
                            setIsDetailOpen(true);
                          }}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                          title="Inspect Error Stack"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        {!isViewer && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSingleRedrive(job);
                            }}
                            disabled={actingJobId === job.id}
                            className="px-2.5 py-1.5 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30 rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50"
                            title="Redrive into queue"
                          >
                            <RotateCcw
                              className={`w-3.5 h-3.5 ${
                                actingJobId === job.id ? 'animate-spin' : ''
                              }`}
                            />
                            <span>Redrive</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800">
            <div>
              Page <span className="text-white font-semibold">{currentPage}</span> of{' '}
              <span className="text-white font-semibold">{totalPages}</span> ({totalItems} dead-letter jobs)
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1 || isLoading}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg transition"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || isLoading}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <JobDetailModal
        job={selectedJob}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onJobUpdated={() => fetchDlqData()}
      />
    </div>
  );
};