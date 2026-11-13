import React, { useState } from 'react';
import { JobType, JobPriority } from '@taskflow/shared';
import { jobApiService, JobRecord } from '../../services/job.service';
import { X, Play, Loader2, Sparkles, RefreshCw } from 'lucide-react';

interface JobSubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJobCreated: (job: JobRecord) => void;
}

const TEMPLATES: Record<
  JobType,
  { name: string; defaultPayload: Record<string, unknown>; priority: number; tags: string[] }
> = {
  [JobType.EMAIL_SIMULATION]: {
    name: 'Transactional Welcome Email',
    defaultPayload: {
      recipient: 'developer@taskflow.dev',
      subject: 'Welcome to Distributed TaskFlow Queue',
      template: 'welcome_onboarding_v2',
      shouldFail: false,
    },
    priority: JobPriority.HIGH,
    tags: ['notifications', 'email'],
  },
  [JobType.DATA_PROCESSING]: {
    name: 'Batch Analytics Aggregation',
    defaultPayload: {
      items: [
        { id: 101, value: 89.5, category: 'finance' },
        { id: 102, value: 310.0, category: 'sales' },
        { id: 103, value: 45.2, category: 'infrastructure' },
        { id: 104, value: 120.8, category: 'finance' },
        { id: 105, value: 95.0, category: 'sales' },
      ],
      operation: 'aggregate',
    },
    priority: JobPriority.NORMAL,
    tags: ['analytics', 'etl'],
  },
  [JobType.REPORT_GENERATION]: {
    name: 'Monthly Performance Audit',
    defaultPayload: {
      reportType: 'performance_audit',
      format: 'pdf',
      dateRange: {
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-13T00:00:00.000Z',
      },
      shouldFail: false,
    },
    priority: JobPriority.NORMAL,
    tags: ['reporting', 'pdf'],
  },
};

export const JobSubmissionModal: React.FC<JobSubmissionModalProps> = ({
  isOpen,
  onClose,
  onJobCreated,
}) => {
  const [selectedType, setSelectedType] = useState<JobType>(JobType.EMAIL_SIMULATION);
  const [name, setName] = useState(TEMPLATES[JobType.EMAIL_SIMULATION].name);
  const [queueName, setQueueName] = useState('default');
  const [priority, setPriority] = useState<number>(JobPriority.NORMAL);
  const [maxAttempts, setMaxAttempts] = useState<number>(3);
  const [delayMs, setDelayMs] = useState<number>(0);
  const [payloadJson, setPayloadJson] = useState<string>(
    JSON.stringify(TEMPLATES[JobType.EMAIL_SIMULATION].defaultPayload, null, 2)
  );
  const [tags, setTags] = useState<string>(TEMPLATES[JobType.EMAIL_SIMULATION].tags.join(', '));
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTemplateSelect = (type: JobType) => {
    setSelectedType(type);
    const tmpl = TEMPLATES[type];
    setName(tmpl.name);
    setPriority(tmpl.priority);
    setPayloadJson(JSON.stringify(tmpl.defaultPayload, null, 2));
    setTags(tmpl.tags.join(', '));
  };

  const handleGenerateIdempotencyKey = () => {
    setIdempotencyKey(`idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      let parsedPayload: Record<string, unknown> = {};
      try {
        parsedPayload = JSON.parse(payloadJson);
      } catch {
        throw new Error('Payload must be a valid JSON object.');
      }

      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const job = await jobApiService.submitJob(
        {
          name,
          type: selectedType,
          queueName,
          payload: parsedPayload,
          priority,
          maxAttempts,
          delayMs,
          tags: parsedTags,
          idempotencyKey: idempotencyKey || undefined,
        },
        idempotencyKey || undefined
      );

      onJobCreated(job);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit job to queue';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur z-10">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Submit Background Job</h2>
              <p className="text-xs text-slate-400">Enqueue a task into BullMQ Redis with persistence</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
              {error}
            </div>
          )}

          {/* Template Selection Pills */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Select Preset Job Type
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(TEMPLATES) as JobType[]).map((type) => (
                <button
                  type="button"
                  key={type}
                  onClick={() => handleTemplateSelect(type)}
                  className={`p-3 rounded-xl border text-left transition text-xs font-medium ${
                    selectedType === type
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="font-bold">{type}</div>
                  <div className="text-[10px] text-slate-400 mt-1 truncate">
                    {TEMPLATES[type].name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Job Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Queue Name
              </label>
              <input
                type="text"
                required
                value={queueName}
                onChange={(e) => setQueueName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Priority (1-10)
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value={1}>1 - Critical</option>
                <option value={2}>2 - High</option>
                <option value={5}>5 - Normal</option>
                <option value={8}>8 - Low</option>
                <option value={10}>10 - Background</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Max Retries
              </label>
              <input
                type="number"
                min={0}
                max={10}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Delay (ms)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={delayMs}
                onChange={(e) => setDelayMs(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Tags (comma separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. email, transactional, critical"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Idempotency Key (Optional)
              </label>
              <button
                type="button"
                onClick={handleGenerateIdempotencyKey}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Generate Key</span>
              </button>
            </div>
            <input
              type="text"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              placeholder="UUID or unique key to prevent duplicate job processing"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Job Payload (JSON)
            </label>
            <textarea
              rows={6}
              value={payloadJson}
              onChange={(e) => setPayloadJson(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-emerald-400 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center space-x-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting to Queue...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Dispatch Job</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
