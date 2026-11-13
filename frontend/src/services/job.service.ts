import { apiClient } from './api.client.js';
import { JobStatus, JobPriority, JobExecutionRecord } from '@taskflow/shared';

export interface JobRecord {
  id: string;
  jobId: string;
  userId: string | { _id: string; name: string; email: string; role: string };
  queueName: string;
  name: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attemptsMade: number;
  maxAttempts: number;
  progress: number;
  result?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
    failedAt?: string;
  };
  idempotencyKey?: string;
  delayMs: number;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  lockedBy?: string;
  tags: string[];
  bullJobId?: string;
  executions?: JobExecutionRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobPayload {
  name: string;
  type: string;
  payload: Record<string, unknown>;
  priority?: JobPriority | number;
  queueName?: string;
  delayMs?: number;
  maxAttempts?: number;
  tags?: string[];
  idempotencyKey?: string;
}

export interface ListJobsParams {
  page?: number;
  limit?: number;
  status?: string;
  queueName?: string;
  type?: string;
  priority?: number;
  search?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedJobsResponse {
  success: boolean;
  data: JobRecord[];
  pagination: {
    totalItems: number;
    totalPages: number;
    currentPage: number;
    limit: number;
  };
}

export const jobApiService = {
  async submitJob(payload: CreateJobPayload, idempotencyKey?: string): Promise<JobRecord> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const response = await apiClient.post<{ success: boolean; data: JobRecord; message: string }>(
      '/api/jobs',
      payload,
      { headers }
    );
    return response.data.data;
  },

  async listJobs(params?: ListJobsParams): Promise<PaginatedJobsResponse> {
    const response = await apiClient.get<PaginatedJobsResponse>('/api/jobs', {
      params,
    });
    return response.data;
  },

  async getJobById(id: string): Promise<JobRecord> {
    const response = await apiClient.get<{ success: boolean; data: JobRecord }>(`/api/jobs/${id}`);
    return response.data.data;
  },

  async cancelJob(id: string, reason?: string): Promise<JobRecord> {
    const response = await apiClient.post<{ success: boolean; data: JobRecord }>(
      `/api/jobs/${id}/cancel`,
      { reason }
    );
    return response.data.data;
  },

  async retryJob(id: string): Promise<JobRecord> {
    const response = await apiClient.post<{ success: boolean; data: JobRecord }>(
      `/api/jobs/${id}/retry`
    );
    return response.data.data;
  },
};
