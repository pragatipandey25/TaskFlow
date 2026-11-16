import { jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { UserModel } from '../../src/models/user.model.js';
import { JobModel } from '../../src/models/job.model.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { queueService } from '../../src/core/queue/queue.service.js';
import { workerManager } from '../../src/core/worker/worker-manager.js';
import { processorRegistry } from '../../src/core/worker/processor.registry.js';
import { UserRole, JobStatus } from '@taskflow/shared';

describe('Retry Mechanisms & Dead-Letter Queue (Integration)', () => {
  const app = createApp();

  let adminUser: any;
  let devUser: any;

  let adminToken: string;
  let devToken: string;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await disconnectRedis();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.restoreAllMocks();

    jest.spyOn(queueService, 'addJob').mockImplementation(async (job) => {
      return `bull_mock_${job.jobId}`;
    });
    jest.spyOn(queueService, 'cancelJob').mockResolvedValue(true);

    adminUser = await UserModel.create({
      name: 'Admin Boss',
      email: 'admin@taskflow.dev',
      passwordHash: 'hash_admin',
      role: UserRole.ADMIN,
    });

    devUser = await UserModel.create({
      name: 'Dev Dave',
      email: 'dave@taskflow.dev',
      passwordHash: 'hash_dev',
      role: UserRole.DEVELOPER,
    });

    adminToken = TokenService.generateAccessToken({
      userId: adminUser._id.toString(),
      email: adminUser.email,
      role: adminUser.role,
    }).accessToken;

    devToken = TokenService.generateAccessToken({
      userId: devUser._id.toString(),
      email: devUser.email,
      role: devUser.role,
    }).accessToken;
  });

  describe('Worker Retry and Quarantine Lifecycle', () => {
    it('should transition job to RETRYING with exponential backoff scheduledAt on non-terminal attempt', async () => {
      const job = await JobModel.create({
        jobId: 'job_transient_01',
        userId: devUser._id,
        name: 'Transient Failure Job',
        type: 'TRANSIENT_TASK',
        payload: { attempt: 1 },
        queueName: 'default',
        status: JobStatus.QUEUED,
        attemptsMade: 0,
        maxAttempts: 3,
        backoff: {
          type: 'exponential',
          delayMs: 2000,
        },
      });

      processorRegistry.register('TRANSIENT_TASK', {
        type: 'TRANSIENT_TASK',
        process: async () => {
          throw new Error('Temporary 503 Service Unavailable');
        },
      });

      const fakeBullJob = {
        id: 'fake_bull_01',
        data: { jobId: 'job_transient_01' },
        updateProgress: jest.fn().mockResolvedValue(true),
      } as any;

      await expect(workerManager.processJob(fakeBullJob)).rejects.toThrow('Temporary 503');

      const inDb = await JobModel.findOne({ jobId: 'job_transient_01' });
      expect(inDb?.status).toBe(JobStatus.RETRYING);
      expect(inDb?.attemptsMade).toBe(1);
      expect(inDb?.scheduledAt).toBeDefined();
      expect(new Date(inDb!.scheduledAt!).getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(
        inDb?.executions[0].logs.some((l: any) => l.message.includes('Next retry scheduled in'))
      ).toBe(true);
    });

    it('should quarantine job to DEAD_LETTER when maximum retry attempts are exhausted', async () => {
      const job = await JobModel.create({
        jobId: 'job_terminal_01',
        userId: devUser._id,
        name: 'Terminal Failure Job',
        type: 'TERMINAL_TASK',
        payload: {},
        queueName: 'default',
        status: JobStatus.RETRYING,
        attemptsMade: 2, // Next attempt will be attempt 3 of 3 (exhausted)
        maxAttempts: 3,
      });

      processorRegistry.register('TERMINAL_TASK', {
        type: 'TERMINAL_TASK',
        process: async () => {
          throw new Error('Fatal unrecoverable error');
        },
      });

      const fakeBullJob = {
        id: 'fake_bull_02',
        data: { jobId: 'job_terminal_01' },
        updateProgress: jest.fn().mockResolvedValue(true),
      } as any;

      await expect(workerManager.processJob(fakeBullJob)).rejects.toThrow('Fatal unrecoverable error');

      const inDb = await JobModel.findOne({ jobId: 'job_terminal_01' });
      expect(inDb?.status).toBe(JobStatus.DEAD_LETTER);
      expect(inDb?.attemptsMade).toBe(3);
      expect(inDb?.failedAt).toBeDefined();
      expect(inDb?.error?.code).toBe('DEAD_LETTER_QUARANTINED');
      expect(
        inDb?.executions[0].logs.some((l: any) =>
          l.message.includes('Quarantined to Dead-Letter Queue')
        )
      ).toBe(true);
    });
  });

  describe('DLQ REST APIs', () => {
    it('POST /api/jobs/:id/retry should redrive a DEAD_LETTER job back to QUEUED', async () => {
      const job = await JobModel.create({
        jobId: 'job_to_redrive_01',
        userId: devUser._id,
        name: 'Dead Job to Redrive',
        type: 'DATA_PROCESS',
        payload: { file: 'archive.tar' },
        queueName: 'default',
        status: JobStatus.DEAD_LETTER,
        attemptsMade: 3,
        maxAttempts: 3,
        failedAt: new Date(),
        error: { message: 'Network timeout', failedAt: new Date() },
      });

      const res = await request(app)
        .post(`/api/jobs/${job.jobId}/retry`)
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(JobStatus.QUEUED);
      expect(res.body.data.attemptsMade).toBe(0);

      const inDb = await JobModel.findOne({ jobId: 'job_to_redrive_01' });
      expect(inDb?.status).toBe(JobStatus.QUEUED);
      expect(inDb?.attemptsMade).toBe(0);
      expect(inDb?.error?.message).toBeUndefined();
    });

    it('POST /api/jobs/:id/cancel should cancel in-flight or queued job and abort BullMQ queue record', async () => {
      const job = await JobModel.create({
        jobId: 'job_to_cancel_01',
        userId: devUser._id,
        name: 'Job to Cancel',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.QUEUED,
        bullJobId: 'bull_123',
      });

      const res = await request(app)
        .post(`/api/jobs/${job.jobId}/cancel`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({ reason: 'Operator manual abort' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(JobStatus.CANCELLED);

      const inDb = await JobModel.findOne({ jobId: 'job_to_cancel_01' });
      expect(inDb?.status).toBe(JobStatus.CANCELLED);
      expect(inDb?.cancelledAt).toBeDefined();
      expect(inDb?.error?.message).toBe('Operator manual abort');
    });

    it('POST /api/jobs/dlq/redrive-all should bulk-redrive all dead-letter jobs', async () => {
      await JobModel.create({
        jobId: 'bulk_dlq_a',
        userId: devUser._id,
        name: 'Bulk DLQ A',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.DEAD_LETTER,
      });

      await JobModel.create({
        jobId: 'bulk_dlq_b',
        userId: devUser._id,
        name: 'Bulk DLQ B',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.DEAD_LETTER,
      });

      const res = await request(app)
        .post('/api/jobs/dlq/redrive-all')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.redrivenCount).toBe(2);

      const remaining = await JobModel.countDocuments({ status: JobStatus.DEAD_LETTER });
      expect(remaining).toBe(0);
    });

    it('GET /api/jobs/dlq/stats should report accurate dead-letter job counts by queue', async () => {
      await JobModel.create({
        jobId: 'dlq_stats_1',
        userId: devUser._id,
        name: 'DLQ Stats 1',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'notifications',
        status: JobStatus.DEAD_LETTER,
      });

      const res = await request(app)
        .get('/api/jobs/dlq/stats')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalDeadLetters).toBe(1);
      expect(res.body.data.byQueue['notifications']).toBe(1);
    });
  });
});
