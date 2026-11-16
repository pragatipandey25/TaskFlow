import { jest } from '@jest/globals';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { dlqService } from '../../src/core/queue/dlq.service.js';
import { JobModel } from '../../src/models/job.model.js';
import { UserModel } from '../../src/models/user.model.js';
import { queueService } from '../../src/core/queue/queue.service.js';
import { JobStatus, UserRole } from '@taskflow/shared';
import { disconnectRedis } from '../../src/config/redis.js';

describe('DlqService (Unit Tests)', () => {
  let testUser: any;

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

    testUser = await UserModel.create({
      name: 'DLQ Test User',
      email: 'dlq@taskflow.dev',
      passwordHash: 'hash',
      role: UserRole.DEVELOPER,
    });

    jest.spyOn(queueService, 'addJob').mockResolvedValue('bull_redrive_mock_id');
  });

  it('should quarantine an exhausted job to DEAD_LETTER and record error diagnostics', async () => {
    const job = await JobModel.create({
      jobId: 'job_dlq_01',
      userId: testUser._id,
      name: 'Failing Job',
      type: 'DEMO_DATA_SYNC',
      payload: { test: true },
      queueName: 'default',
      attemptsMade: 3,
      maxAttempts: 3,
      status: JobStatus.PROCESSING,
      executions: [
        {
          attemptNumber: 3,
          workerId: 'worker-unit-test',
          status: 'PROCESSING',
          startedAt: new Date().toISOString(),
          logs: [],
        },
      ],
    });

    const fatalError = new Error('Database unreachable error: password=secret123');
    await dlqService.quarantineJob(job, fatalError, 1200);

    const updatedJob = await JobModel.findOne({ jobId: 'job_dlq_01' });
    expect(updatedJob?.status).toBe(JobStatus.DEAD_LETTER);
    expect(updatedJob?.failedAt).toBeDefined();
    expect(updatedJob?.error?.message).toBe('Database unreachable error: password=[REDACTED]');
    expect(updatedJob?.executions[0].status).toBe('FAILED');
    expect(updatedJob?.executions[0].logs.length).toBeGreaterThan(0);
    expect(
      updatedJob?.executions[0].logs.some((l: any) =>
        l.message.includes('Quarantined to Dead-Letter Queue')
      )
    ).toBe(true);
  });

  it('should manually redrive a DEAD_LETTER job back to QUEUED and reset attempts', async () => {
    const job = await JobModel.create({
      jobId: 'job_dlq_02',
      userId: testUser._id,
      name: 'Quarantined Job',
      type: 'DEMO_DATA_SYNC',
      payload: { data: 'test' },
      queueName: 'default',
      attemptsMade: 3,
      maxAttempts: 3,
      status: JobStatus.DEAD_LETTER,
      failedAt: new Date(),
      error: {
        message: 'Timeout error',
        failedAt: new Date(),
      },
    });

    const redriven = await dlqService.redriveJob(
      job._id.toString(),
      testUser._id.toString(),
      UserRole.DEVELOPER
    );

    expect(redriven.status).toBe(JobStatus.QUEUED);
    expect(redriven.attemptsMade).toBe(0);
    expect(redriven.error?.message).toBeUndefined();
    expect(redriven.bullJobId).toBe('bull_redrive_mock_id');

    // Verify execution audit log was appended
    const updated = await JobModel.findOne({ jobId: 'job_dlq_02' });
    expect(updated?.executions.length).toBeGreaterThan(0);
    expect(updated?.executions[updated.executions.length - 1].logs[0].message).toContain(
      'Job redriven manually from DEAD_LETTER'
    );
  });

  it('should reject redrive attempts on jobs not in DEAD_LETTER or FAILED status', async () => {
    const job = await JobModel.create({
      jobId: 'job_dlq_03',
      userId: testUser._id,
      name: 'Active Job',
      type: 'DEMO_DATA_SYNC',
      payload: {},
      queueName: 'default',
      status: JobStatus.COMPLETED,
    });

    await expect(
      dlqService.redriveJob(job._id.toString(), testUser._id.toString(), UserRole.DEVELOPER)
    ).rejects.toThrow(/cannot be redriven from current status 'COMPLETED'/);
  });

  it('should bulk redrive multiple dead-letter jobs', async () => {
    await JobModel.create({
      jobId: 'bulk_dlq_1',
      userId: testUser._id,
      name: 'Bulk 1',
      type: 'DEMO_DATA_SYNC',
      payload: {},
      queueName: 'bulk-queue',
      status: JobStatus.DEAD_LETTER,
    });

    await JobModel.create({
      jobId: 'bulk_dlq_2',
      userId: testUser._id,
      name: 'Bulk 2',
      type: 'DEMO_DATA_SYNC',
      payload: {},
      queueName: 'bulk-queue',
      status: JobStatus.DEAD_LETTER,
    });

    const result = await dlqService.bulkRedrive('bulk-queue', testUser._id.toString(), UserRole.DEVELOPER);

    expect(result.redrivenCount).toBe(2);
    expect(result.jobIds).toEqual(expect.arrayContaining(['bulk_dlq_1', 'bulk_dlq_2']));

    const remainingDlq = await JobModel.countDocuments({
      queueName: 'bulk-queue',
      status: JobStatus.DEAD_LETTER,
    });
    expect(remainingDlq).toBe(0);
  });

  it('should compute aggregated DLQ stats by queue', async () => {
    await JobModel.create({
      jobId: 'stats_dlq_1',
      userId: testUser._id,
      name: 'Stats 1',
      type: 'DEMO_DATA_SYNC',
      payload: {},
      queueName: 'emails',
      status: JobStatus.DEAD_LETTER,
    });

    await JobModel.create({
      jobId: 'stats_dlq_2',
      userId: testUser._id,
      name: 'Stats 2',
      type: 'DEMO_DATA_SYNC',
      payload: {},
      queueName: 'transcoding',
      status: JobStatus.DEAD_LETTER,
    });

    const stats = await dlqService.getDlqStats(UserRole.ADMIN, testUser._id.toString());
    expect(stats.totalDeadLetters).toBe(2);
    expect(stats.byQueue['emails']).toBe(1);
    expect(stats.byQueue['transcoding']).toBe(1);
  });
});
