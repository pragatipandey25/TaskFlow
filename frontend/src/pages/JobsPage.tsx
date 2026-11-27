import React from 'react';
import { JobList } from '../components/jobs/JobList';
import { Briefcase } from 'lucide-react';

export const JobsPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-indigo-400" />
            Background Job Management
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Dispatch, search, filter, monitor progress, and manage lifecycles across all registered queues.
          </p>
        </div>
      </div>

      <JobList />
    </div>
  );
};