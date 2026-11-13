import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { JobModel } from '../../src/models/job.model.js';
import { JobStatus, JobPriority } from '@taskflow/shared';
import { jobReconciliationService } from '../../src/core/queue/reconciliation.service.js';
import { queueService } from '../../src/core/queue/queue.service.js';

describe('Job Reconciliation Service (Unit / Dual-Write Resilience)', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.restoreAllMocks();
  });

  it('should find orphaned PENDING jobs and reconcile them to QUEUED', async () => {
    const userId = new mongoose.Types.ObjectId();

    // Create an orphaned PENDING job with createdAt set to 20 seconds ago
    const twentySecondsAgo = new Date(Date.now() - 20000);
    const orphanedJob = await JobModel.create({
      jobId: 'job_orphaned_01',
      userId,
      name: 'Orphaned Job',
      type: 'EMAIL_SIMULATION',
      payload: { to: 'test@taskflow.dev' },
      status: JobStatus.PENDING,
      priority: JobPriority.NORMAL,
      createdAt: twentySecondsAgo,
      updatedAt: twentySecondsAgo,
    });

    // Mock queueService.addJob to simulate successful BullMQ connection
    const addJobSpy = jest
      .spyOn(queueService, 'addJob')
      .mockResolvedValueOnce('bull_job_reconciled_101');

    const summary = await jobReconciliationService.reconcilePendingJobs(10000);

    expect(summary.inspected).toBe(1);
    expect(summary.reconciled).toBe(1);
    expect(summary.failed).toBe(0);
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    const updatedJob = await JobModel.findById(orphanedJob._id);
    expect(updatedJob?.status).toBe(JobStatus.QUEUED);
    expect(updatedJob?.bullJobId).toBe('bull_job_reconciled_101');
  });

  it('should not reconcile freshly created PENDING jobs below cutoff threshold', async () => {
    const userId = new mongoose.Types.ObjectId();

    // Create fresh job created just now (0 seconds ago)
    await JobModel.create({
      jobId: 'job_fresh_01',
      userId,
      name: 'Fresh Job',
      type: 'DATA_PROCESSING',
      payload: {},
      status: JobStatus.PENDING,
    });

    const addJobSpy = jest.spyOn(queueService, 'addJob');
    const summary = await jobReconciliationService.reconcilePendingJobs(10000);

    expect(summary.inspected).toBe(0);
    expect(summary.reconciled).toBe(0);
    expect(addJobSpy).not.toHaveBeenCalled();
  });

  it('should track failure when Redis enqueue fails during reconciliation', async () => {
    const userId = new mongoose.Types.ObjectId();
    const thirtySecondsAgo = new Date(Date.now() - 30000);

    const orphanedJob = await JobModel.create({
      jobId: 'job_failing_reconciliation',
      userId,
      name: 'Failing Job',
      type: 'REPORT_GENERATION',
      payload: {},
      status: JobStatus.PENDING,
      createdAt: thirtySecondsAgo,
      updatedAt: thirtySecondsAgo,
    });

    // Mock queueService.addJob throwing ECONNREFUSED
    jest
      .spyOn(queueService, 'addJob')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

    const summary = await jobReconciliationService.reconcilePendingJobs(10000);

    expect(summary.inspected).toBe(1);
    expect(summary.reconciled).toBe(0);
    expect(summary.failed).toBe(1);

    const jobAfter = await JobModel.findById(orphanedJob._id);
    expect(jobAfter?.status).toBe(JobStatus.PENDING);
  });
});
