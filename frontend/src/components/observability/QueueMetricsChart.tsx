import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { QueueListItem } from '../../services/queue.service.js';

interface QueueMetricsChartProps {
  queues: QueueListItem[];
  isLoading: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  waiting: '#f59e0b', // Amber
  active: '#3b82f6', // Blue
  delayed: '#8b5cf6', // Purple
  completed: '#10b981', // Emerald
  failed: '#ef4444', // Rose
};

export const QueueMetricsChart: React.FC<QueueMetricsChartProps> = ({ queues, isLoading }) => {
  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex items-center space-x-3 text-slate-400">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Loading queue telemetry...</span>
        </div>
      </div>
    );
  }

  if (queues.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-xl">
        <p className="text-slate-500 text-sm">No active queues discovered.</p>
      </div>
    );
  }

  // Aggregate job counts across queues
  const aggregateCounts = queues.reduce(
    (acc, q) => {
      acc.waiting += q.jobCounts?.waiting || 0;
      acc.active += q.jobCounts?.active || 0;
      acc.delayed += q.jobCounts?.delayed || 0;
      acc.completed += q.jobCounts?.completed || 0;
      acc.failed += q.jobCounts?.failed || 0;
      return acc;
    },
    { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 }
  );

  const chartData = [
    { state: 'Waiting', count: aggregateCounts.waiting, key: 'waiting' },
    { state: 'Active', count: aggregateCounts.active, key: 'active' },
    { state: 'Delayed', count: aggregateCounts.delayed, key: 'delayed' },
    { state: 'Completed', count: aggregateCounts.completed, key: 'completed' },
    { state: 'Failed', count: aggregateCounts.failed, key: 'failed' },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-slate-800 gap-2">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            Queue Depth & State Distribution
          </h3>
          <p className="text-xs text-slate-400">
            Real-time backlog across {queues.length} registered {queues.length === 1 ? 'queue' : 'queues'}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="text-slate-300">Waiting: {aggregateCounts.waiting}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-slate-300">Active: {aggregateCounts.active}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-slate-300">Completed: {aggregateCounts.completed}</span>
          </div>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <XAxis dataKey="state" stroke="#64748b" fontSize={12} tickLine={false} />
            <YAxis stroke="#64748b" fontSize={12} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                borderColor: '#334155',
                borderRadius: '0.5rem',
                fontSize: '0.85rem',
                color: '#f8fafc',
              }}
              formatter={(value: number) => [`${value} jobs`, 'Count']}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={`cell-${entry.key}`} fill={STATUS_COLORS[entry.key] || '#6366f1'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
