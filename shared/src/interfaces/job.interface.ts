import { JobStatus } from '../enums/job-status.enum.js';
import { JobPriority } from '../enums/job-priority.enum.js';

export interface BackoffConfig {
  type: 'exponential' | 'fixed';
  delayMs: number;
}

export interface JobPayload<T = Record<string, unknown>> {
  [key: string]: unknown;
  data?: T;
}

export interface CreateJobInput {
  queueName: string;
  name: string;
  type: string;
  payload: Record<string, unknown>;
  priority?: JobPriority | number;
  maxRetries?: number;
  backoffPolicy?: BackoffConfig;
  delayMs?: number;
  tags?: string[];
  idempotencyKey?: string;
}

export interface JobExecutionLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface JobExecutionRecord {
  attemptNumber: number;
  workerId: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  memoryUsageBytes?: number;
  cpuUsagePct?: number;
  errorDetails?: {
    message: string;
    stack?: string;
    code?: string;
  };
  logs: JobExecutionLog[];
}

export interface JobResponse {
  id: string;
  queueId: string;
  queueName?: string;
  userId: string;
  bullJobId?: string;
  name: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  status: JobStatus;
  idempotencyKey?: string;
  maxRetries: number;
  currentRetries: number;
  backoffPolicy: BackoffConfig;
  delayMs?: number;
  scheduledFor?: string;
  lockedBy?: string;
  result?: Record<string, unknown>;
  failureReason?: string;
  tags: string[];
  executions?: JobExecutionRecord[];
  createdAt: string;
  updatedAt: string;
}
