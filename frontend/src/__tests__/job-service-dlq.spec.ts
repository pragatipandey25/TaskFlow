import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { apiClient } from '../services/api.client';
import { jobApiService, CreateJobPayload, ListJobsParams } from '../services/job.service';
import { JobStatus, JobPriority, JobType } from '@taskflow/shared';

describe('Job API Service & DLQ Client', () => {
  let getSpy: any;
  let postSpy: any;

  beforeEach(() => {
    getSpy = jest.spyOn(apiClient, 'get');
    postSpy = jest.spyOn(apiClient, 'post');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('submitJob', () => {
    it('should forward idempotency key header when provided', async () => {
      const mockJob = { id: 'j_123', jobId: 'job_123', name: 'Test', type: JobType.EMAIL_SIMULATION };
      postSpy.mockResolvedValueOnce({
        data: { success: true, data: mockJob, message: 'Created' },
      });

      const payload: CreateJobPayload = {
        name: 'Test Email Job',
        type: JobType.EMAIL_SIMULATION,
        payload: { recipient: 'dev@test.com' },
        priority: JobPriority.HIGH,
      };

      const result = await jobApiService.submitJob(payload, 'idemp_key_999');

      expect(postSpy).toHaveBeenCalledWith(
        '/jobs',
        payload,
        { headers: { 'Idempotency-Key': 'idemp_key_999' } }
      );
      expect(result).toEqual(mockJob);
    });
  });

  describe('listJobs', () => {
    it('should pass pagination, status, and search filters correctly', async () => {
      const mockPaginated = {
        success: true,
        data: [{ id: '1' }],
        pagination: { totalItems: 1, totalPages: 1, currentPage: 1, limit: 10 },
      };
      getSpy.mockResolvedValueOnce({ data: mockPaginated });

      const params: ListJobsParams = {
        page: 2,
        limit: 10,
        status: JobStatus.FAILED,
        queueName: 'critical',
        search: 'invoice',
        sortBy: 'priority',
        order: 'asc',
      };

      const res = await jobApiService.listJobs(params);

      expect(getSpy).toHaveBeenCalledWith('/jobs', { params });
      expect(res).toEqual(mockPaginated);
    });
  });

  describe('cancelJob & retryJob', () => {
    it('should call cancel endpoint with optional reason', async () => {
      postSpy.mockResolvedValueOnce({
        data: { success: true, data: { id: 'job_1', status: JobStatus.CANCELLED } },
      });

      const res = await jobApiService.cancelJob('job_1', 'Operator cancellation');

      expect(postSpy).toHaveBeenCalledWith('/jobs/job_1/cancel', {
        reason: 'Operator cancellation',
      });
      expect(res.status).toBe(JobStatus.CANCELLED);
    });

    it('should call retry endpoint to re-enqueue job', async () => {
      postSpy.mockResolvedValueOnce({
        data: { success: true, data: { id: 'job_1', status: JobStatus.QUEUED } },
      });

      const res = await jobApiService.retryJob('job_1');

      expect(postSpy).toHaveBeenCalledWith('/jobs/job_1/retry');
      expect(res.status).toBe(JobStatus.QUEUED);
    });
  });

  describe('DLQ Operations', () => {
    it('should fetch DLQ statistics summary', async () => {
      const mockStats = { totalDeadLetters: 5, byQueue: { default: 3, critical: 2 } };
      getSpy.mockResolvedValueOnce({
        data: { success: true, data: mockStats },
      });

      const res = await jobApiService.getDlqStats();

      expect(getSpy).toHaveBeenCalledWith('/jobs/dlq/stats');
      expect(res).toEqual(mockStats);
    });

    it('should trigger bulk redrive across all or specific queue', async () => {
      const mockRedrive = { redrivenCount: 4, jobIds: ['1', '2', '3', '4'] };
      postSpy.mockResolvedValueOnce({
        data: { success: true, data: mockRedrive, message: 'Redriven' },
      });

      const res = await jobApiService.bulkRedrive('default');

      expect(postSpy).toHaveBeenCalledWith('/jobs/dlq/redrive-all', null, {
        params: { queueName: 'default' },
      });
      expect(res.redrivenCount).toBe(4);
    });
  });
});