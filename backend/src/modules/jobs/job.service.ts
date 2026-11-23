import crypto from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { JobModel, IJobDocument } from '../../models/job.model.js';
import { JobStatus, UserRole, SocketEventName } from '@taskflow/shared';
import { CreateJobDTO, ListJobsQueryDTO } from './job.validation.js';
import { queueService } from '../../core/queue/queue.service.js';
import { AppError, NotFoundError, ForbiddenError } from '../../core/errors/app-error.js';
import { logger } from '../../core/logging/logger.js';

import { dlqService } from '../../core/queue/dlq.service.js';
import { workerManager } from '../../core/worker/worker-manager.js';
import { eventPublisher } from '../../core/socket/event-publisher.js';

export interface PaginatedJobsResult {
  jobs: IJobDocument[];
  pagination: {
    totalItems: number;
    totalPages: number;
    currentPage: number;
    limit: number;
  };
}

export class JobService {
  private static instance: JobService;

  private constructor() {}

  public static getInstance(): JobService {
    if (!JobService.instance) {
      JobService.instance = new JobService();
    }
    return JobService.instance;
  }

  /**
   * Submits a new background job with idempotency protection and BullMQ dispatch.
   */
  public async submitJob(
    userId: string,
    input: CreateJobDTO,
    idempotencyHeader?: string
  ): Promise<{ job: IJobDocument; isDuplicate: boolean }> {
    const idempotencyKey = input.idempotencyKey || idempotencyHeader;

    // 1. Idempotency Check: Prevent duplicate submissions
    if (idempotencyKey) {
      const existingJob = await JobModel.findOne({
        idempotencyKey,
        userId: new Types.ObjectId(userId),
      });

      if (existingJob) {
        logger.info(
          `Idempotent duplicate submission detected for key '${idempotencyKey}'. Returning existing job '${existingJob.jobId}'.`
        );
        return { job: existingJob, isDuplicate: true };
      }
    }

    // 2. Persist to MongoDB with status PENDING (Transactional Outbox Pattern)
    const jobId = `job_${crypto.randomUUID()}`;
    const initialStatus = input.delayMs > 0 ? JobStatus.DELAYED : JobStatus.PENDING;

    const jobDoc = new JobModel({
      jobId,
      userId: new Types.ObjectId(userId),
      queueName: input.queueName || 'default',
      name: input.name,
      type: input.type,
      payload: input.payload,
      priority: input.priority,
      maxAttempts: input.maxAttempts,
      backoff: input.backoff,
      delayMs: input.delayMs,
      status: initialStatus,
      tags: input.tags || [],
      idempotencyKey,
      scheduledAt: input.delayMs > 0 ? new Date(Date.now() + input.delayMs) : undefined,
    });

    await jobDoc.save();

    // Broadcast job:submitted event
    await eventPublisher.publishJobEvent(SocketEventName.JOB_SUBMITTED, {
      jobId: jobDoc.jobId,
      userId: jobDoc.userId.toString(),
      queueName: jobDoc.queueName,
      type: jobDoc.type,
      status: jobDoc.status,
      priority: jobDoc.priority,
      maxAttempts: jobDoc.maxAttempts,
      scheduledAt: jobDoc.scheduledAt?.toISOString(),
    });

    // 3. Dispatch to BullMQ Queue
    try {
      const bullJobId = await queueService.addJob(jobDoc);
      jobDoc.bullJobId = bullJobId;
      jobDoc.status = input.delayMs > 0 ? JobStatus.DELAYED : JobStatus.QUEUED;
      await jobDoc.save();

      // Broadcast job:queued event
      await eventPublisher.publishJobEvent(SocketEventName.JOB_QUEUED, {
        jobId: jobDoc.jobId,
        userId: jobDoc.userId.toString(),
        queueName: jobDoc.queueName,
        type: jobDoc.type,
        status: jobDoc.status,
        priority: jobDoc.priority,
        maxAttempts: jobDoc.maxAttempts,
      });
    } catch (err: unknown) {
      // If Redis is temporarily down, the job remains in PENDING state in MongoDB.
      // The JobReconciliationService will safely sweep and enqueue it once Redis recovers.
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Dual-write notice: Redis enqueue failed for job '${jobId}'. Record preserved in MongoDB as PENDING for automated reconciliation. Error: ${errorMsg}`
      );
      jobDoc.error = {
        message: `Queue submission pending: Redis temporarily unavailable (${errorMsg})`,
        failedAt: new Date(),
      };
      await jobDoc.save();
    }

    return { job: jobDoc, isDuplicate: false };
  }

  /**
   * Retrieves a paginated list of jobs filtered by user permissions and query parameters.
   */
  public async listJobs(
    userId: string,
    userRole: UserRole,
    query: ListJobsQueryDTO
  ): Promise<PaginatedJobsResult> {
    const filter: Record<string, unknown> = {};

    // RBAC: Non-admin users are strictly quarantined to their own jobs
    if (userRole !== UserRole.ADMIN) {
      filter.userId = new Types.ObjectId(userId);
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.queueName) {
      filter.queueName = query.queueName;
    }

    if (query.type) {
      filter.type = query.type;
    }

    if (query.priority) {
      filter.priority = query.priority;
    }

    if (query.search) {
      const searchRegex = new RegExp(query.search, 'i');
      filter.$or = [{ name: searchRegex }, { tags: { $in: [query.search] } }];
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const sortField = query.sortBy || 'createdAt';
    const sortOrder = query.order === 'asc' ? 1 : -1;

    const [totalItems, jobs] = await Promise.all([
      JobModel.countDocuments(filter),
      JobModel.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email role'),
    ]);

    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      jobs,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit,
      },
    };
  }

  /**
   * Fetches full job details and execution history with ownership verification.
   */
  public async getJobById(
    identifier: string,
    userId: string,
    userRole: UserRole
  ): Promise<IJobDocument> {
    const job = await this.findJobByIdentifier(identifier);

    // Ownership Enforcement
    if (userRole !== UserRole.ADMIN && job.userId.toString() !== userId) {
      throw new ForbiddenError('Access forbidden: You do not have permission to view this job');
    }

    return job;
  }

  /**
   * Cancels an in-flight, queued, or delayed job.
   */
  public async cancelJob(
    identifier: string,
    userId: string,
    userRole: UserRole,
    reason?: string
  ): Promise<IJobDocument> {
    const job = await this.findJobByIdentifier(identifier);

    if (userRole !== UserRole.ADMIN && job.userId.toString() !== userId) {
      throw new ForbiddenError('Access forbidden: You do not have permission to cancel this job');
    }

    const cancellableStates = [
      JobStatus.PENDING,
      JobStatus.DELAYED,
      JobStatus.QUEUED,
      JobStatus.PROCESSING,
      JobStatus.RETRYING,
    ];

    if (!cancellableStates.includes(job.status)) {
      throw new AppError(
        `Job cannot be cancelled in its current state: '${job.status}'. Only pending, delayed, queued, or running jobs can be cancelled.`,
        400,
        'BAD_REQUEST'
      );
    }

    // If job is in-flight / processing, cooperatively notify the worker
    if (job.status === JobStatus.PROCESSING) {
      workerManager.cancelActiveJob(job.jobId, reason);
    }

    // Cancel in BullMQ if enqueued
    if (job.bullJobId) {
      await queueService.cancelJob(job.queueName, job.bullJobId);
    }

    const cancellationNotice = reason
      ? `Job cancelled by operator request: ${reason}. Note: In-flight operations may have partially executed; external side effects are not automatically rolled back.`
      : 'Job cancelled by operator request. Note: In-flight operations may have partially executed; external side effects are not automatically rolled back.';

    job.status = JobStatus.CANCELLED;
    job.cancelledAt = new Date();
    job.error = {
      message: cancellationNotice,
      failedAt: new Date(),
    };

    // Update execution history record if currently processing
    const currentExec = job.executions[job.executions.length - 1];
    if (currentExec && currentExec.status === 'PROCESSING') {
      currentExec.status = 'FAILED';
      currentExec.completedAt = new Date().toISOString();
      currentExec.logs.push({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: cancellationNotice,
      });
    }

    await job.save();

    // Broadcast job:cancelled event
    await eventPublisher.publishJobEvent(SocketEventName.JOB_CANCELLED, {
      jobId: job.jobId,
      userId: job.userId.toString(),
      queueName: job.queueName,
      type: job.type,
      status: JobStatus.CANCELLED,
      cancelledAt: job.cancelledAt.toISOString(),
      error: { message: cancellationNotice, code: 'JOB_CANCELLED' },
    });

    logger.info(`Job '${job.jobId}' cancelled successfully by user '${userId}'.`);
    return job;
  }

  /**
   * Manually redrives or retries a FAILED or DEAD_LETTER job.
   */
  public async retryJob(
    identifier: string,
    userId: string,
    userRole: UserRole
  ): Promise<IJobDocument> {
    return dlqService.redriveJob(identifier, userId, userRole);
  }

  /**
   * Bulk redrives all dead-letter jobs, optionally filtered by queue.
   */
  public async bulkRedrive(
    userId: string,
    userRole: UserRole,
    queueName?: string
  ): Promise<{ redrivenCount: number; jobIds: string[] }> {
    return dlqService.bulkRedrive(queueName, userId, userRole);
  }

  /**
   * Retrieves summary metrics for dead-letter jobs.
   */
  public async getDlqStats(
    userId: string,
    userRole: UserRole
  ): Promise<{ totalDeadLetters: number; byQueue: Record<string, number> }> {
    return dlqService.getDlqStats(userRole, userId);
  }

  private async findJobByIdentifier(identifier: string): Promise<IJobDocument> {
    let job: IJobDocument | null = null;

    if (mongoose.Types.ObjectId.isValid(identifier)) {
      job = await JobModel.findById(identifier);
    }

    if (!job) {
      job = await JobModel.findOne({ jobId: identifier });
    }

    if (!job) {
      throw new NotFoundError(`Job with identifier '${identifier}' not found`);
    }

    return job;
  }
}

export const jobService = JobService.getInstance();
