import { apiClient } from './api.client.js';
import { WorkerResponse } from '@taskflow/shared';

export interface WorkerDetailResponse extends WorkerResponse {
  uptimeSeconds: number;
  currentJobs: Array<{
    jobId: string;
    name: string;
    elapsedMs: number;
  }>;
}

export const workerService = {
  async listWorkers(): Promise<WorkerResponse[]> {
    const res = await apiClient.get<{ success: boolean; data: WorkerResponse[] }>('/workers');
    return res.data.data;
  },

  async getWorkerById(id: string): Promise<WorkerDetailResponse> {
    const res = await apiClient.get<{ success: boolean; data: WorkerDetailResponse }>(`/workers/${id}`);
    return res.data.data;
  },
};
