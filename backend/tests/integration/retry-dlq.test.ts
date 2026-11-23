import { jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { UserModel } from '../../src/models/user.model.js';
import { JobModel } from '../../src/models/job.model.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { queueService } from '../../src/core/queue/queue.service.js';
import { dlqService } from '../../src/core/queue/dlq.service.js';
import { workerManager } from '../../src/core/worker/worker-manager.js';
import { processorRegistry } from '../../src/core/worker/processor.registry.js';
import { UserRole, JobStatus } from '@taskflow/shared';

describe('Milestone 5: Retry Mechanisms, DLQ & Cancellation Audit (Integration)', () => {
  jest.setTimeout(60000);
  const app = createApp();

  let adminUser: any;
  let devUserA: any;
  let devUserB: any;
  let viewerUser: any;

  let adminToken: string;
  let devTokenA: string;
  let devTokenB: string;
  let viewerToken: string;

  beforeAll(async () => {
    await setupTestDatabase();
  }, 60000);

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

    devUserA = await UserModel.create({
      name: 'Dev Alice',
      email: 'alice@taskflow.dev',
      passwordHash: 'hash_alice',
      role: UserRole.DEVELOPER,
    });

    devUserB = await UserModel.create({
      name: 'Dev Bob',
      email: 'bob@taskflow.dev',
      passwordHash: 'hash_bob',
      role: UserRole.DEVELOPER,
    });

    viewerUser = await UserModel.create({
      name: 'Viewer Victor',
      email: 'victor@taskflow.dev',
      passwordHash: 'hash_victor',
      role: UserRole.VIEWER,
    });

    adminToken = TokenService.generateAccessToken({
      userId: adminUser._id.toString(),
      email: adminUser.email,
      role: adminUser.role,
    }).accessToken;

    devTokenA = TokenService.generateAccessToken({
      userId: devUserA._id.toString(),
      email: devUserA.email,
      role: devUserA.role,
    }).accessToken;

    devTokenB = TokenService.generateAccessToken({
      userId: devUserB._id.toString(),
      email: devUserB.email,
      role: devUserB.role,
    }).accessToken;

    viewerToken = TokenService.generateAccessToken({
      userId: viewerUser._id.toString(),
      email: viewerUser.email,
      role: viewerUser.role,
    }).accessToken;
  });

  // =========================================================================
  // 1. Bulk DLQ Redrive Authorization & Scoping
  // =========================================================================
  describe('Bulk DLQ Redrive Authorization & Scoping', () => {
    beforeEach(async () => {
      // Create Dead-Letter jobs for Alice
      await JobModel.create([
        {
          jobId: 'alice_dlq_01',
          userId: devUserA._id,
          name: 'Alice DLQ Default',
          type: 'DATA_PROCESS',
          payload: {},
          queueName: 'default',
          status: JobStatus.DEAD_LETTER,
          attemptsMade: 3,
          maxAttempts: 3,
        },
        {
          jobId: 'alice_dlq_02',
          userId: devUserA._id,
          name: 'Alice DLQ Transcode',
          type: 'DATA_PROCESS',
          payload: {},
          queueName: 'transcoding',
          status: JobStatus.DEAD_LETTER,
          attemptsMade: 3,
          maxAttempts: 3,
        },
      ]);

      // Create Dead-Letter jobs for Bob
      await JobModel.create([
        {
          jobId: 'bob_dlq_01',
          userId: devUserB._id,
          name: 'Bob DLQ Default',
          type: 'DATA_PROCESS',
          payload: {},
          queueName: 'default',
          status: JobStatus.DEAD_LETTER,
          attemptsMade: 3,
          maxAttempts: 3,
        },
      ]);
    });

    it('Developer A can bulk redrive only their own dead-letter jobs', async () => {
      const res = await request(app)
        .post('/api/jobs/dlq/redrive-all')
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.redrivenCount).toBe(2);
      expect(res.body.data.jobIds).toContain('alice_dlq_01');
      expect(res.body.data.jobIds).toContain('alice_dlq_02');
      expect(res.body.data.jobIds).not.toContain('bob_dlq_01');

      // Verify MongoDB records: Alice's jobs are QUEUED, Bob's job remains DEAD_LETTER
      const aliceJob1 = await JobModel.findOne({ jobId: 'alice_dlq_01' });
      const bobJob1 = await JobModel.findOne({ jobId: 'bob_dlq_01' });
      expect(aliceJob1?.status).toBe(JobStatus.QUEUED);
      expect(bobJob1?.status).toBe(JobStatus.DEAD_LETTER);
    });

    it('Developer A cannot redrive Developer B job via single redrive (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/jobs/bob_dlq_01/retry')
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);

      const bobJob = await JobModel.findOne({ jobId: 'bob_dlq_01' });
      expect(bobJob?.status).toBe(JobStatus.DEAD_LETTER);
    });

    it('Developer A scoping by queueName redrives only their jobs within that queue', async () => {
      const res = await request(app)
        .post('/api/jobs/dlq/redrive-all')
        .set('Authorization', `Bearer ${devTokenA}`)
        .send({ queueName: 'transcoding' });

      expect(res.status).toBe(200);
      expect(res.body.data.redrivenCount).toBe(1);
      expect(res.body.data.jobIds).toEqual(['alice_dlq_02']);

      const aliceJob1 = await JobModel.findOne({ jobId: 'alice_dlq_01' });
      const aliceJob2 = await JobModel.findOne({ jobId: 'alice_dlq_02' });
      expect(aliceJob1?.status).toBe(JobStatus.DEAD_LETTER);
      expect(aliceJob2?.status).toBe(JobStatus.QUEUED);
    });

    it('Admin can bulk redrive dead-letter jobs across ALL users', async () => {
      const res = await request(app)
        .post('/api/jobs/dlq/redrive-all')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.redrivenCount).toBe(3);
      expect(res.body.data.jobIds).toContain('alice_dlq_01');
      expect(res.body.data.jobIds).toContain('alice_dlq_02');
      expect(res.body.data.jobIds).toContain('bob_dlq_01');

      const remainingDeadLetters = await JobModel.countDocuments({ status: JobStatus.DEAD_LETTER });
      expect(remainingDeadLetters).toBe(0);
    });

    it('Viewer role is rejected with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/jobs/dlq/redrive-all')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
    });

    it('Unauthenticated request is rejected with 401 Unauthorized', async () => {
      const res = await request(app).post('/api/jobs/dlq/redrive-all');
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 2. Retry, Quarantine Idempotency & BullMQ Consistency
  // =========================================================================
  describe('Retry & BullMQ Consistency', () => {
    it('should transition job to RETRYING with exponential backoff scheduledAt on transient failure', async () => {
      const job = await JobModel.create({
        jobId: 'job_transient_01',
        userId: devUserA._id,
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
    });

    it('should quarantine job to DEAD_LETTER when maximum retry attempts are exhausted', async () => {
      const job = await JobModel.create({
        jobId: 'job_terminal_01',
        userId: devUserA._id,
        name: 'Terminal Failure Job',
        type: 'TERMINAL_TASK',
        payload: {},
        queueName: 'default',
        status: JobStatus.RETRYING,
        attemptsMade: 2, // Next attempt will be attempt 3 of 3 (exhausted)
        maxAttempts: 3,
      });

      processorRegistry.register('TERMINAL_TASK', {
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
    });

    it('repeated failure events cannot create duplicate DLQ entries (quarantine idempotency)', async () => {
      const job = await JobModel.create({
        jobId: 'job_idempotent_dlq',
        userId: devUserA._id,
        name: 'Idempotency Test Job',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.RETRYING,
        attemptsMade: 3,
        maxAttempts: 3,
      });

      const err = new Error('Repeated poison pill error');

      // First quarantine call
      await dlqService.quarantineJob(job, err, 500);
      const afterFirst = await JobModel.findOne({ jobId: 'job_idempotent_dlq' });
      expect(afterFirst?.status).toBe(JobStatus.DEAD_LETTER);
      const executionCount = afterFirst?.executions.length;

      // Second redundant quarantine call (e.g. repeated failure event)
      await dlqService.quarantineJob(afterFirst!, err, 500);
      const afterSecond = await JobModel.findOne({ jobId: 'job_idempotent_dlq' });

      // Must remain in DEAD_LETTER without duplicate executions or state corruption
      expect(afterSecond?.status).toBe(JobStatus.DEAD_LETTER);
      expect(afterSecond?.executions.length).toBe(executionCount);
    });

    it('concurrent redrive requests on the same job: exactly one succeeds with QUEUED, the other gets 409 Conflict', async () => {
      const job = await JobModel.create({
        jobId: 'job_concurrent_redrive',
        userId: devUserA._id,
        name: 'Concurrent Redrive Test',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.DEAD_LETTER,
        attemptsMade: 3,
        maxAttempts: 3,
      });

      // Fire two simultaneous redrive operations
      const [res1, res2] = await Promise.allSettled([
        dlqService.redriveJob(job.jobId, devUserA._id.toString(), UserRole.DEVELOPER),
        dlqService.redriveJob(job.jobId, devUserA._id.toString(), UserRole.DEVELOPER),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // The rejected one should have failed with CONFLICT / 409 or BAD_REQUEST
      const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectionReason.statusCode).toBe(409);

      // MongoDB final state must be clean QUEUED with 0 attempts made
      const finalDoc = await JobModel.findOne({ jobId: 'job_concurrent_redrive' });
      expect(finalDoc?.status).toBe(JobStatus.QUEUED);
      expect(finalDoc?.attemptsMade).toBe(0);
    });

    it('Redis interruption during redrive restores MongoDB state to DEAD_LETTER (503 Service Unavailable)', async () => {
      const job = await JobModel.create({
        jobId: 'job_redis_outage',
        userId: devUserA._id,
        name: 'Redis Outage Job',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.DEAD_LETTER,
        attemptsMade: 3,
        maxAttempts: 3,
      });

      // Simulate Redis queue failure during addJob
      jest.spyOn(queueService, 'addJob').mockRejectedValueOnce(
        new Error('ECONNREFUSED: Redis cluster node unavailable')
      );

      await expect(
        dlqService.redriveJob(job.jobId, devUserA._id.toString(), UserRole.DEVELOPER)
      ).rejects.toMatchObject({
        statusCode: 503,
      });

      // Verify MongoDB state remained consistently DEAD_LETTER
      const restoredJob = await JobModel.findOne({ jobId: 'job_redis_outage' });
      expect(restoredJob?.status).toBe(JobStatus.DEAD_LETTER);
      expect(restoredJob?.attemptsMade).toBe(3);
      expect(restoredJob?.error?.message).toContain('ECONNREFUSED');
    });
  });

  // =========================================================================
  // 3. Cancellation Regression & Cooperative Cancellation
  // =========================================================================
  describe('Cancellation Regression & Cooperative Cancellation', () => {
    it('Pending, Queued, Delayed, and Retrying jobs can be cancelled cleanly', async () => {
      const queuedJob = await JobModel.create({
        jobId: 'job_cancel_queued',
        userId: devUserA._id,
        name: 'Cancel Queued',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.QUEUED,
        bullJobId: 'bull_queued_1',
      });

      const retryingJob = await JobModel.create({
        jobId: 'job_cancel_retrying',
        userId: devUserA._id,
        name: 'Cancel Retrying',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.RETRYING,
        bullJobId: 'bull_retrying_1',
      });

      const resQueued = await request(app)
        .post(`/api/jobs/${queuedJob.jobId}/cancel`)
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(resQueued.status).toBe(200);
      expect(resQueued.body.data.status).toBe(JobStatus.CANCELLED);

      const resRetrying = await request(app)
        .post(`/api/jobs/${retryingJob.jobId}/cancel`)
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(resRetrying.status).toBe(200);
      expect(resRetrying.body.data.status).toBe(JobStatus.CANCELLED);

      // Verify BullMQ cancelJob was called
      expect(queueService.cancelJob).toHaveBeenCalledWith('default', 'bull_queued_1');
      expect(queueService.cancelJob).toHaveBeenCalledWith('default', 'bull_retrying_1');
    });

    it('Cancellation explicitly includes side-effect disclaimer', async () => {
      const job = await JobModel.create({
        jobId: 'job_disclaimer_test',
        userId: devUserA._id,
        name: 'Disclaimer Test',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.QUEUED,
      });

      const res = await request(app)
        .post(`/api/jobs/${job.jobId}/cancel`)
        .set('Authorization', `Bearer ${devTokenA}`)
        .send({ reason: 'Operator requested termination' });

      expect(res.status).toBe(200);
      const inDb = await JobModel.findOne({ jobId: 'job_disclaimer_test' });
      expect(inDb?.status).toBe(JobStatus.CANCELLED);
      expect(inDb?.error?.message).toContain('Operator requested termination');
      expect(inDb?.error?.message).toContain('external side effects are not automatically rolled back');
    });

    it('Active execution receives cooperative AbortSignal and does not overwrite CANCELLED with COMPLETED', async () => {
      const job = await JobModel.create({
        jobId: 'job_active_cancel_01',
        userId: devUserA._id,
        name: 'Long Active Task',
        type: 'LONG_ACTIVE_TASK',
        payload: {},
        queueName: 'default',
        status: JobStatus.QUEUED,
        attemptsMade: 0,
        maxAttempts: 3,
      });

      let receivedAbortSignal: AbortSignal | undefined;

      processorRegistry.register('LONG_ACTIVE_TASK', {
        process: async (j, updateProgress, signal) => {
          receivedAbortSignal = signal;
          // Step 1: 50%
          await updateProgress(50, 'Halfway done');

          // Simulate cancellation happening externally
          await JobModel.updateOne({ jobId: j.jobId }, { status: JobStatus.CANCELLED, cancelledAt: new Date() });

          // Step 2: attempt next progress update
          await updateProgress(75, 'Attempting further work');
          return { done: true };
        },
      });

      const fakeBullJob = {
        id: 'fake_bull_active',
        data: { jobId: 'job_active_cancel_01' },
        updateProgress: jest.fn().mockResolvedValue(true),
      } as any;

      const result = await workerManager.processJob(fakeBullJob);

      expect(receivedAbortSignal).toBeDefined();
      expect(result.cancelled).toBe(true);

      const finalJob = await JobModel.findOne({ jobId: 'job_active_cancel_01' });
      expect(finalJob?.status).toBe(JobStatus.CANCELLED);
      expect(finalJob?.status).not.toBe(JobStatus.COMPLETED);
    });

    it('Completed jobs cannot be cancelled (400 Bad Request)', async () => {
      const completedJob = await JobModel.create({
        jobId: 'already_completed_job',
        userId: devUserA._id,
        name: 'Done Job',
        type: 'DATA_PROCESS',
        payload: {},
        queueName: 'default',
        status: JobStatus.COMPLETED,
      });

      const res = await request(app)
        .post(`/api/jobs/${completedJob.jobId}/cancel`)
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
