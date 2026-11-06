import { WorkerStatus } from '../enums/worker-status.enum.js';

export interface WorkerMetrics {
  rssMemoryBytes: number;
  heapUsedBytes: number;
  cpuPercent: number;
}

export interface WorkerResponse {
  workerId: string;
  hostname: string;
  pid: number;
  queuesSubscribed: string[];
  concurrency: number;
  activeJobCount: number;
  status: WorkerStatus;
  lastHeartbeat: string;
  startedAt: string;
  version: string;
  systemMetrics?: WorkerMetrics;
}
