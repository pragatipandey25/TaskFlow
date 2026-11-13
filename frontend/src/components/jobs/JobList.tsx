import React, { useState, useEffect, useCallback } from 'react';
import { JobRecord, jobApiService } from '../../services/job.service';
import { JobStatus } from '@taskflow/shared';
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
} from 'lucide-react';
import { JobSubmissionModal } from './JobSubmissionModal';
import { JobDetailModal } from './JobDetailModal';

export const JobList: React.FC = () => {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // Modals state
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const statusParam = activeTab === 'ALL' ? undefined : activeTab;
      const response = await jobApiService.listJobs({
        page: currentPage,
        limit: 10,
        status: statusParam,
        search: searchQuery.trim() || undefined,
      });

      setJobs(response.data);
      setTotalPages(response.pagination.totalPages);
      setTotalItems(response.pagination.totalItems);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, searchQuery, currentPage]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(() => {
      fetchJobs();
    }, 5000); // Poll status every 5 seconds
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

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case JobStatus.COMPLETED:
        return 'bg-emerald-950/80 text-emerald-400 border-emerald-800';
      case JobStatus.PROCESSING:
        return 'bg-indigo-950/80 text-indigo-400 border-indigo-800 animate-pulse';
      case JobStatus.QUEUED:
        return 'bg-sky-950/80 text-sky-400 border-sky-800';
      case JobStatus.DELAYED:
        return 'bg-amber-950/80 text-amber-400 border-amber-800';
      case JobStatus.FAILED:
      case JobStatus.DEAD_LETTER:
        return 'bg-rose-950/80 text-rose-400 border-rose-800';
      case JobStatus.RETRYING:
        return 'bg-orange-950/80 text-orange-400 border-orange-800';
      case JobStatus.CANCELLED:
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  const getPriorityBadge = (priority: number) => {
    if (priority <= 1)
      return <span className="text-rose-400 font-bold bg-rose-950/50 px-2 py-0.5 rounded border border-rose-900 text-[10px]">P1 CRITICAL</span>;
    if (priority <= 3)
      return <span className="text-amber-400 font-bold bg-amber-950/50 px-2 py-0.5 rounded border border-amber-900 text-[10px]">P{priority} HIGH</span>;
    if (priority <= 6)
      return <span className="text-sky-400 font-bold bg-sky-950/50 px-2 py-0.5 rounded border border-sky-900 text-[10px]">P{priority} NORMAL</span>;
    return <span className="text-slate-400 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-[10px]">P{priority} LOW</span>;
  };

  const filterTabs = [
    { label: 'All Jobs', value: 'ALL' },
    { label: 'Queued', value: JobStatus.QUEUED },
    { label: 'Processing', value: JobStatus.PROCESSING },
    { label: 'Completed', value: JobStatus.COMPLETED },
    { label: 'Retrying', value: JobStatus.RETRYING },
    { label: 'Dead Letter', value: JobStatus.DEAD_LETTER },
    { label: 'Delayed', value: JobStatus.DELAYED },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
      {/* Top Header Controls */}
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

          <button
            onClick={() => setIsSubmitOpen(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center space-x-2"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Submit New Job</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        {/* Filter Pills */}
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

        {/* Search */}
        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name or tags..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Jobs Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
            <tr>
              <th className="py-3 px-4">Job Info</th>
              <th className="py-3 px-4">Queue & Type</th>
              <th className="py-3 px-4">Priority</th>
              <th className="py-3 px-4">Status & Progress</th>
              <th className="py-3 px-4">Attempts</th>
              <th className="py-3 px-4">Submitted</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {isLoading && jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500 mb-2" />
                  <span>Loading jobs queue...</span>
                </td>
              </tr>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">
                  <Inbox className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                  <div className="font-semibold text-slate-300">No jobs found</div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Submit your first job using the button above to test distributed BullMQ execution.
                  </p>
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr
                  key={job.id}
                  className="hover:bg-slate-900/60 transition group cursor-pointer"
                  onClick={() => openJobDetail(job)}
                >
                  <td className="py-3 px-4">
                    <div className="font-bold text-white group-hover:text-indigo-400 transition truncate max-w-xs">
                      {job.name}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate max-w-xs">
                      {job.jobId}
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <div className="text-slate-300 font-medium">{job.type}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      queue: {job.queueName}
                    </div>
                  </td>

                  <td className="py-3 px-4">{getPriorityBadge(job.priority)}</td>

                  <td className="py-3 px-4 min-w-[150px]">
                    <div className="flex items-center space-x-2 mb-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusBadge(
                          job.status
                        )}`}
                      >
                        {job.status}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{job.progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          job.status === JobStatus.COMPLETED
                            ? 'bg-emerald-500'
                            : job.status === JobStatus.FAILED || job.status === JobStatus.DEAD_LETTER
                            ? 'bg-rose-500'
                            : 'bg-indigo-500'
                        }`}
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  </td>

                  <td className="py-3 px-4 text-slate-300 font-mono">
                    {job.attemptsMade} / {job.maxAttempts}
                  </td>

                  <td className="py-3 px-4 text-slate-400">
                    <div>{new Date(job.createdAt).toLocaleTimeString()}</div>
                    <div className="text-[10px] text-slate-500">
                      {new Date(job.createdAt).toLocaleDateString()}
                    </div>
                  </td>

                  <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end space-x-1.5">
                      <button
                        onClick={() => openJobDetail(job)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                        title="View details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      {[JobStatus.FAILED, JobStatus.DEAD_LETTER].includes(job.status) && (
                        <button
                          onClick={async () => {
                            try {
                              const updated = await jobApiService.retryJob(job.id);
                              handleJobUpdated(updated);
                            } catch (err) {
                              alert(err instanceof Error ? err.message : 'Retry failed');
                            }
                          }}
                          className="p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/50 rounded-lg transition"
                          title="Retry job"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {[JobStatus.PENDING, JobStatus.QUEUED, JobStatus.PROCESSING].includes(
                        job.status
                      ) && (
                        <button
                          onClick={async () => {
                            try {
                              const updated = await jobApiService.cancelJob(job.id);
                              handleJobUpdated(updated);
                            } catch (err) {
                              alert(err instanceof Error ? err.message : 'Cancel failed');
                            }
                          }}
                          className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 rounded-lg transition"
                          title="Cancel job"
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

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400 pt-2">
          <div>
            Page <span className="font-bold text-white">{currentPage}</span> of{' '}
            <span className="font-bold text-white">{totalPages}</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-300 rounded-lg transition"
            >
              Previous
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-300 rounded-lg transition"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Submission Modal */}
      <JobSubmissionModal
        isOpen={isSubmitOpen}
        onClose={() => setIsSubmitOpen(false)}
        onJobCreated={handleJobCreated}
      />

      {/* Detail Modal */}
      <JobDetailModal
        job={selectedJob}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onJobUpdated={handleJobUpdated}
      />
    </div>
  );
};
