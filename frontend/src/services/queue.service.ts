import { apiClient } from './api.client.js';
import { QueueResponse, QueueStatistics } from '@taskflow/shared';

export interface QueueListItem extends QueueResponse {
  jobCounts: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
  };
}

export const queueService = {
  async listQueues(): Promise<QueueListItem[]> {
    const res = await apiClient.get<{ success: boolean; data: QueueListItem[] }>('/queues');
    return res.data.data;
  },

  async getQueueStats(id: string): Promise<QueueStatistics> {
    const res = await apiClient.get<{ success: boolean; data: QueueStatistics }>(`/queues/${id}/stats`);
    return res.data.data;
  },
};
