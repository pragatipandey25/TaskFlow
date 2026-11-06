export interface QueueRateLimit {
  maxJobs: number;
  durationMs: number;
}

export interface QueueResponse {
  id: string;
  name: string;
  description?: string;
  defaultPriority: number;
  maxConcurrency: number;
  rateLimit: QueueRateLimit;
  status: 'active' | 'paused';
  createdAt: string;
  updatedAt: string;
}

export interface QueueJobCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused?: number;
}

export interface QueueThroughput {
  completedLastMinute: number;
  failedLastMinute: number;
}

export interface QueueStatistics {
  queueId: string;
  name: string;
  isPaused: boolean;
  counts: QueueJobCounts;
  throughput: QueueThroughput;
  estimatedWaitTimeMs: number;
}
