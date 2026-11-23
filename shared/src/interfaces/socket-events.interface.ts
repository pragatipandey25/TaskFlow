import { JobStatus } from '../enums/job-status.enum.js';
import { WorkerStatus } from '../enums/worker-status.enum.js';
import { UserRole } from '../enums/user-role.enum.js';

export enum SocketEventName {
  // Job lifecycle events
  JOB_SUBMITTED = 'job:submitted',
  JOB_QUEUED = 'job:queued',
  JOB_STARTED = 'job:started',
  JOB_PROGRESS = 'job:progress',
  JOB_RETRYING = 'job:retrying',
  JOB_COMPLETED = 'job:completed',
  JOB_FAILED = 'job:failed',
  JOB_CANCELLED = 'job:cancelled',
  JOB_DEAD_LETTERED = 'job:dead-lettered',

  // Queue telemetry events
  QUEUE_STATS = 'queue:stats',
  QUEUE_UPDATED = 'queue:updated',

  // Worker telemetry events
  WORKER_REGISTERED = 'worker:registered',
  WORKER_HEARTBEAT = 'worker:heartbeat',
  WORKER_STATUS = 'worker:status',
  WORKER_UNREGISTERED = 'worker:unregistered',

  // System & Connection events
  SYSTEM_CONNECTED = 'system:connected',
  SYSTEM_ERROR = 'system:error',
}

export interface SocketEventEnvelope<T = unknown> {
  eventId: string;
  eventType: SocketEventName | string;
  timestamp: string;
  version: '1.0';
  data: T;
}

export interface JobEventPayload {
  jobId: string;
  userId: string;
  queueName: string;
  type: string;
  status: JobStatus;
  priority?: number;
  attemptsMade?: number;
  maxAttempts?: number;
  progress?: number;
  progressMessage?: string;
  workerId?: string;
  result?: Record<string, unknown>;
  error?: {
    message: string;
    code?: string;
  };
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
}

export interface JobProgressPayload {
  jobId: string;
  userId: string;
  queueName: string;
  progress: number;
  message?: string;
  workerId?: string;
  timestamp: string;
}

export interface QueueTelemetryPayload {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  deadLetter?: number;
  paused: boolean;
  timestamp: string;
}

export interface WorkerTelemetryPayload {
  workerId: string;
  status: WorkerStatus | string;
  activeJobs: number;
  concurrency: number;
  queues: string[];
  lastHeartbeat: string;
  metrics?: {
    memoryRssBytes: number;
    heapUsedBytes: number;
    cpuPercent: number;
  };
}

export interface SystemConnectedPayload {
  socketId: string;
  userId: string;
  role: UserRole;
  serverTime: string;
}

export interface SystemErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

// Client to Server emission payloads
export interface SubscribeJobPayload {
  jobId: string;
}

export interface UnsubscribeJobPayload {
  jobId: string;
}

export interface SubscribeQueuePayload {
  queueName: string;
}

export interface UnsubscribeQueuePayload {
  queueName: string;
}
