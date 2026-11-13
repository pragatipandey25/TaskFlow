import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { JobModel } from '../../src/models/job.model.js';
import { workerManager } from '../../src/core/worker/worker-manager.js';
import { registerDefaultProcessors } from '../../src/core/worker/register-processors.js';
import { JobStatus, JobType, JobPriority } from '@taskflow/shared';

describe('Background Worker Processing Engine (Integration)', () => {
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await setupTestDatabase();
    registerDefaultProcessors();
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await disconnectRedis();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('should process EMAIL_SIMULATION job to completion with progress and result in MongoDB', async () => {
    const job = await JobModel.create({
      jobId: 'worker_email_test_1',
      userId,
      name: 'Simulated Email',
      type: JobType.EMAIL_SIMULATION,
      payload: {
        to: 'recipient@taskflow.dev',
        subject: 'Worker Test Subject',
      },
      status: JobStatus.QUEUED,
      priority: JobPriority.NORMAL,
      maxAttempts: 3,
    });

    const mockBullJob: any = {
      id: 'bull_email_1',
      data: { jobId: job.jobId },
      attemptsMade: 0,
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };

    const result = await workerManager.processJob(mockBullJob);

    expect(result).toBeDefined();
    expect(result.recipient).toBe('recipient@taskflow.dev');
    expect(mockBullJob.updateProgress).toHaveBeenCalledWith(100);

    // Verify MongoDB state
    const updated = await JobModel.findOne({ jobId: job.jobId });
    expect(updated?.status).toBe(JobStatus.COMPLETED);
    expect(updated?.progress).toBe(100);
    expect(updated?.completedAt).toBeDefined();
    expect(updated?.result).toBeDefined();
    expect(updated?.executions.length).toBe(1);
    expect(updated?.executions[0].status).toBe('COMPLETED');
    expect(updated?.executions[0].logs.length).toBeGreaterThan(0);
  });

  it('should process DATA_PROCESSING job and calculate accurate metrics', async () => {
    const job = await JobModel.create({
      jobId: 'worker_data_test_1',
      userId,
      name: 'Aggregated Data Job',
      type: JobType.DATA_PROCESSING,
      payload: {
        items: [
          { id: 1, value: 50, category: 'A' },
          { id: 2, value: 150, category: 'B' },
        ],
      },
      status: JobStatus.QUEUED,
    });

    const mockBullJob: any = {
      id: 'bull_data_1',
      data: { jobId: job.jobId },
      attemptsMade: 0,
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };

    const result = await workerManager.processJob(mockBullJob);
    expect(result.recordCount).toBe(2);
    expect(result.metrics).toEqual({
      sum: 200,
      average: 100,
      min: 50,
      max: 150,
    });

    const inDb = await JobModel.findOne({ jobId: job.jobId });
    expect(inDb?.status).toBe(JobStatus.COMPLETED);
  });

  it('should transition to RETRYING when transient error occurs and retries remain', async () => {
    const job = await JobModel.create({
      jobId: 'transient_fail_job',
      userId,
      name: 'Transient Fail Job',
      type: JobType.EMAIL_SIMULATION,
      payload: {
        to: 'fail@taskflow.dev',
        shouldFail: true,
        failUntilAttempt: 2,
      },
      status: JobStatus.QUEUED,
      attemptsMade: 0,
      maxAttempts: 3,
    });

    const mockBullJob: any = {
      id: 'bull_fail_1',
      data: { jobId: job.jobId },
      attemptsMade: 0,
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };

    await expect(workerManager.processJob(mockBullJob)).rejects.toThrow(
      /SMTP 503 Transient Relay Failure/
    );

    const inDb = await JobModel.findOne({ jobId: job.jobId });
    expect(inDb?.status).toBe(JobStatus.RETRYING);
    expect(inDb?.attemptsMade).toBe(1);
    expect(inDb?.error?.message).toContain('SMTP 503 Transient Relay Failure');
    expect(inDb?.executions[0].status).toBe('FAILED');
  });

  it('should transition to DEAD_LETTER when attempts reach maxAttempts', async () => {
    const job = await JobModel.create({
      jobId: 'terminal_fail_job',
      userId,
      name: 'Terminal Failure Job',
      type: JobType.EMAIL_SIMULATION,
      payload: {
        to: 'fail_forever@taskflow.dev',
        shouldFail: true,
      },
      status: JobStatus.RETRYING,
      attemptsMade: 2, // 2 attempts already made
      maxAttempts: 3, // 3rd attempt is final
    });

    const mockBullJob: any = {
      id: 'bull_fail_terminal',
      data: { jobId: job.jobId },
      attemptsMade: 2,
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };

    await expect(workerManager.processJob(mockBullJob)).rejects.toThrow();

    const inDb = await JobModel.findOne({ jobId: job.jobId });
    expect(inDb?.status).toBe(JobStatus.DEAD_LETTER);
    expect(inDb?.attemptsMade).toBe(3);
    expect(inDb?.failedAt).toBeDefined();
    expect(inDb?.executions.length).toBe(1);
  });

  it('should skip processing if job was already cancelled', async () => {
    const job = await JobModel.create({
      jobId: 'pre_cancelled_job',
      userId,
      name: 'Pre-cancelled Job',
      type: JobType.EMAIL_SIMULATION,
      payload: {},
      status: JobStatus.CANCELLED,
    });

    const mockBullJob: any = {
      id: 'bull_cancelled_1',
      data: { jobId: job.jobId },
      attemptsMade: 0,
      updateProgress: jest.fn(),
    };

    const result = await workerManager.processJob(mockBullJob);
    expect(result.skipped).toBe(true);

    const inDb = await JobModel.findOne({ jobId: job.jobId });
    expect(inDb?.status).toBe(JobStatus.CANCELLED);
  });
});
