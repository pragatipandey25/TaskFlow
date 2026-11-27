import React, { useState, useEffect, useCallback, useRef } from 'react';
import { JobRecord, jobApiService } from '../../services/job.service';
import { JobStatus, SocketEventName, UserRole, JobType } from '@taskflow/shared';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { useJobEvents } from '../../hooks/useJobEvents';
import { queueService } from '../../services/queue.service';
import {
  Play,
  RotateCcw,
  Ban,
  Search,
  RefreshCw,
  Eye,
  Inbox,
  AlertCircle,
  Loader2,
  Filter,
  ArrowUpDown,
  Copy,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { JobSubmissionModal } from './JobSubmissionModal';
import { JobDetailModal } from './JobDetailModal';

interface JobListProps {
  initialStatusFilter?: string;
  hideHeaderActions?: boolean;
}

export const JobList: React.FC<JobListProps> = ({
  initialStatusFilter,
  hideHeaderActions = false,
}) => {
  const { user } = useAuth();
  const isViewer = user?.role === UserRole.VIEWER;

  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [activeTab, setActiveTab] = useState<string>(initialStatusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [selectedQueue, setSelectedQueue] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [availableQueues, setAvailableQueues] = useState<string[]>([]);

  // Sorting & Pagination
  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // Modals state
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Action in-flight tracking
  const [actingJobId, setActingJobId] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Load available queues for filter dropdown
  useEffect(() => {
    queueService
      .listQueues()
      .then((qList) => setAvailableQueues(qList.map((q) => q.name)))
      .catch(() => {});
  }, []);

  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const statusParam = activeTab === 'ALL' ? undefined : activeTab;
      const queueParam = selectedQueue === 'ALL' ? undefined : selectedQueue;
      const typeParam = selectedType === 'ALL' ? undefined : selectedType;

      const response = await jobApiService.listJobs({
        page: currentPage,
        limit: 10,
        status: statusParam,
        queueName: queueParam,
        type: typeParam,
        search: debouncedSearch || undefined,
        sortBy,
        order,
      });

      setJobs(response.data);
      setTotalPages(response.pagination.totalPages);
      setTotalItems(response.pagination.totalItems);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, selectedQueue, selectedType, debouncedSearch, currentPage, sortBy, order]);

  const { isConnected, isReconnecting } = useSocket();
  const wasReconnecting = useRef(false);

  // Real-time job event listener: updates rows in-place instantly
  useJobEvents({
    onEvent: (envelope) => {
      const data = envelope.data;
      if (!data || !('jobId' in data)) return;
      const jobId = data.jobId;

      setJobs((prevJobs) => {
        const index = prevJobs.findIndex((j) => j.jobId === jobId || j.id === jobId);
        if (index === -1) {
          if (envelope.eventType === SocketEventName.JOB_SUBMITTED && currentPage === 1) {
            fetchJobs();
          }
          return prevJobs;
        }

        const existing = prevJobs[index];
        const updated: JobRecord = { ...existing };

        if ('status' in data && data.status) {
          updated.status = data.status;
        }
        if ('progress' in data && data.progress !== undefined) {
          updated.progress = data.progress;
        }
        if ('attemptsMade' in data && data.attemptsMade !== undefined) {
          updated.attemptsMade = data.attemptsMade;
        }

        const newJobs = [...prevJobs];
        newJobs[index] = updated;

        // Keep detail modal updated if open for this job
        if (selectedJob && (selectedJob.jobId === jobId || selectedJob.id === jobId)) {
          setSelectedJob(updated);
        }

        return newJobs;
      });
    },
  });

  // Re-fetch automatically when socket reconnects after disconnection
  useEffect(() => {
    if (wasReconnecting.current && isConnected) {
      fetchJobs();
    }
    wasReconnecting.current = isReconnecting;
  }, [isConnected, isReconnecting, fetchJobs]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(() => {
      fetchJobs();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleJobCreated = (newJob: JobRecord) => {
    setJobs((prev) => [newJob, ...prev]);
    setSelectedJob(newJob);
    setIsDetailOpen(true);
  };

  const handleJobUpdated = (updatedJob: JobRecord) => {
    setJobs((prev) => prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)));
    if (selectedJob?.id === updatedJob.id) {
      setSelectedJob(updatedJob);
    }
  };

  const openJobDetail = (job: JobRecord) => {
    setSelectedJob(job);
    setIsDetailOpen(true);
  };

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleQuickRetry = async (job: JobRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isViewer) return;
    setActingJobId(job.id);
    try {
      const updated = await jobApiService.retryJob(job.id);
      handleJobUpdated(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setActingJobId(null);
    }
  };

  const handleQuickCancel = async (job: JobRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isViewer) return;
    if (!window.confirm(`Are you sure you want to cancel job ${job.name}?`)) return;
    setActingJobId(job.id);
    try {
      const updated = await jobApiService.cancelJob(job.id, 'Cancelled via Quick Action');
      handleJobUpdated(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setActingJobId(null);
    }
  };

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case JobStatus.COMPLETED:
        return 'bg-emerald-950/80 text-emerald-400 border-emerald-800';
      case JobStatus.PROCESSING:
        return 'bg-indigo-950/80 text-indigo-400 border-indigo-800 animate-pulse';
      case JobStatus.QUEUED:
        return 'bg-sky-950/80 text-sky-400 border-sky-800';
      case JobStatus.PENDING:
        return 'bg-amber-950/80 text-amber-400 border-amber-800';
      case JobStatus.DELAYED:
        return 'bg-amber-950/80 text-amber-400 border-amber-800';
      case JobStatus.FAILED:
        return 'bg-rose-950/80 text-rose-400 border-rose-800';
      case JobStatus.DEAD_LETTER:
        return 'bg-orange-950/80 text-orange-400 border-orange-800';
      case JobStatus.RETRYING:
        return 'bg-purple-950/80 text-purple-400 border-purple-800';
      case JobStatus.CANCELLED:
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  const getPriorityBadge = (priority: number) => {
    if (priority <= 1)
      return (
        <span className="text-rose-400 font-bold bg-rose-950/50 px-2 py-0.5 rounded border border-rose-900 text-[10px]">
          P1 CRITICAL
        </span>
      );
    if (priority <= 3)
      return (
        <span className="text-amber-400 font-bold bg-amber-950/50 px-2 py-0.5 rounded border border-amber-900 text-[10px]">
          P{priority} HIGH
        </span>
      );
    if (priority <= 6)
      return (
        <span className="text-sky-400 font-bold bg-sky-950/50 px-2 py-0.5 rounded border border-sky-900 text-[10px]">
          P{priority} NORMAL
        </span>
      );
    return (
      <span className="text-slate-400 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-[10px]">
        P{priority} LOW
      </span>
    );
  };

  const filterTabs = [
    { label: 'All Jobs', value: 'ALL' },
    { label: 'Queued', value: JobStatus.QUEUED },
    { label: 'Processing', value: JobStatus.PROCESSING },
    { label: 'Completed', value: JobStatus.COMPLETED },
    { label: 'Retrying', value: JobStatus.RETRYING },
    { label: 'Dead Letter', value: JobStatus.DEAD_LETTER },
    { label: 'Failed', value: JobStatus.FAILED },
    { label: 'Cancelled', value: JobStatus.CANCELLED },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
      {/* Top Header Controls */}
      {!hideHeaderActions && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Active Background Jobs</h2>
              <span className="px-2.5 py-0.5 bg-slate-800 text-slate-400 rounded-full text-xs font-semibold">
                {totalItems} total
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Real-time BullMQ queue pipeline, concurrency status, and worker executions
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => fetchJobs()}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition"
              title="Refresh list"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>

            {isViewer ? (
              <div className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800/60 border border-slate-700 text-slate-400 rounded-xl text-xs font-medium">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                <span>Read-Only Viewer</span>
              </div>
            ) : (
              <button
                onClick={() => setIsSubmitOpen(true)}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center space-x-2"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Submit New Job</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setActiveTab(tab.value);
              setCurrentPage(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition border ${
              activeTab === tab.value
                ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500 shadow'
                : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Advanced Filter Bar (Search, Queue, Type, Sort) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by ID, name, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>

        {/* Queue Dropdown */}
        <div className="flex items-center space-x-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-1.5">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[11px] text-slate-400">Queue:</span>
          <select
            value={selectedQueue}
            onChange={(e) => {
              setSelectedQueue(e.target.value);
              setCurrentPage(1);
            }}
            className="bg-transparent text-xs text-slate-200 focus:outline-none flex-1"
          >
            <option value="ALL" className="bg-slate-900">All Queues</option>
            {availableQueues.map((q) => (
              <option key={q} value={q} className="bg-slate-900">
                {q}
              </option>
            ))}
          </select>
        </div>

        {/* Job Type Dropdown */}
        <div className="flex items-center space-x-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-1.5">
          <span className="text-[11px] text-slate-400">Type:</span>
          <select
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setCurrentPage(1);
            }}
            className="bg-transparent text-xs text-slate-200 focus:outline-none flex-1"
          >
            <option value="ALL" className="bg-slate-900">All Processor Types</option>
            <option value={JobType.EMAIL_SIMULATION} className="bg-slate-900">Email Simulation</option>
            <option value={JobType.DATA_PROCESSING} className="bg-slate-900">Data Processing</option>
            <option value={JobType.REPORT_GENERATION} className="bg-slate-900">Report Generation</option>
          </select>
        </div>

        {/* Sort By Dropdown */}
        <div className="flex items-center space-x-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-1.5">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[11px] text-slate-400">Sort:</span>
          <select
            value={`${sortBy}:${order}`}
            onChange={(e) => {
              const [newSort, newOrder] = e.target.value.split(':');
              setSortBy(newSort);
              setOrder(newOrder as 'asc' | 'desc');
            }}
            className="bg-transparent text-xs text-slate-200 focus:outline-none flex-1"
          >
            <option value="createdAt:desc" className="bg-slate-900">Newest First</option>
            <option value="createdAt:asc" className="bg-slate-900">Oldest First</option>
            <option value="priority:asc" className="bg-slate-900">Highest Priority</option>
            <option value="status:asc" className="bg-slate-900">Status</option>
            <option value="name:asc" className="bg-slate-900">Name (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/80 uppercase font-semibold text-slate-400 border-b border-slate-800 text-[10px] tracking-wider">
            <tr>
              <th className="py-3.5 px-4">Job Details</th>
              <th className="py-3.5 px-4">Queue & Type</th>
              <th className="py-3.5 px-4">Priority</th>
              <th className="py-3.5 px-4">Status & Progress</th>
              <th className="py-3.5 px-4">Attempts</th>
              <th className="py-3.5 px-4">Timeline</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
            {isLoading && jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                    <span>Synchronizing background jobs...</span>
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-rose-400">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <AlertCircle className="w-6 h-6" />
                    <span>{error}</span>
                  </div>
                </td>
              </tr>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <Inbox className="w-8 h-8 opacity-40" />
                    <p className="text-sm font-semibold">No matching jobs discovered</p>
                    <p className="text-xs text-slate-400">
                      Submit a new background job or adjust active search filters.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => openJobDetail(job)}
                  className="hover:bg-slate-800/50 cursor-pointer transition"
                >
                  {/* Job Details */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-white truncate max-w-[200px]">
                        {job.name}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 mt-1">
                      <span className="font-mono text-[10px] text-slate-400">
                        {job.jobId ? job.jobId.slice(0, 16) : job.id.slice(0, 16)}...
                      </span>
                      <button
                        onClick={(e) => handleCopyId(job.jobId || job.id, e)}
                        className="text-slate-500 hover:text-slate-300 p-0.5 rounded transition"
                        title="Copy Job ID"
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
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-200">{job.queueName}</span>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                        {job.type}
                      </span>
                    </div>
                  </td>

                  {/* Priority */}
                  <td className="py-3.5 px-4">{getPriorityBadge(job.priority)}</td>

                  {/* Status & Progress */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-1.5">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${getStatusBadge(
                          job.status
                        )}`}
                      >
                        {job.status}
                      </span>
                      {job.status === JobStatus.PROCESSING && (
                        <div className="w-24 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${job.progress || 0}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Attempts */}
                  <td className="py-3.5 px-4 text-slate-300">
                    {job.attemptsMade} / {job.maxAttempts}
                  </td>

                  {/* Timeline */}
                  <td className="py-3.5 px-4 text-[11px] text-slate-400">
                    <div>Created {new Date(job.createdAt).toLocaleTimeString()}</div>
                    <div className="text-[10px] text-slate-500">
                      {new Date(job.createdAt).toLocaleDateString()}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end space-x-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openJobDetail(job);
                        }}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                        title="View Full Diagnostics & Logs"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      {!isViewer &&
                        (job.status === JobStatus.FAILED ||
                          job.status === JobStatus.DEAD_LETTER) && (
                          <button
                            onClick={(e) => handleQuickRetry(job, e)}
                            disabled={actingJobId === job.id}
                            className="p-1.5 bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-400 border border-indigo-800/80 rounded-lg transition disabled:opacity-50"
                            title="Retry Execution"
                          >
                            <RotateCcw
                              className={`w-3.5 h-3.5 ${
                                actingJobId === job.id ? 'animate-spin' : ''
                              }`}
                            />
                          </button>
                        )}

                      {!isViewer &&
                        (job.status === JobStatus.PENDING ||
                          job.status === JobStatus.QUEUED ||
                          job.status === JobStatus.PROCESSING) && (
                          <button
                            onClick={(e) => handleQuickCancel(job, e)}
                            disabled={actingJobId === job.id}
                            className="p-1.5 bg-rose-950/60 hover:bg-rose-900/60 text-rose-400 border border-rose-800/80 rounded-lg transition disabled:opacity-50"
                            title="Cancel Job"
                          >
                            <Ban className="w-3.5 h-3.5" />
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
        <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
          <div>
            Showing Page <span className="text-white font-semibold">{currentPage}</span> of{' '}
            <span className="text-white font-semibold">{totalPages}</span> ({totalItems} total jobs)
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

      {/* Modals */}
      <JobSubmissionModal
        isOpen={isSubmitOpen}
        onClose={() => setIsSubmitOpen(false)}
        onJobCreated={handleJobCreated}
      />

      <JobDetailModal
        job={selectedJob}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onJobUpdated={handleJobUpdated}
      />
    </div>
  );
};