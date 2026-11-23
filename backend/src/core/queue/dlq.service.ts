import { JobModel, IJobDocument } from '../../models/job.model.js';
import { queueService } from './queue.service.js';
import { JobStatus, UserRole } from '@taskflow/shared';
import { logger } from '../logging/logger.js';
import { sanitizePayload } from '../logging/log-sanitizer.js';
import { AppError, NotFoundError } from '../errors/app-error.js';
import { getRedisClient } from '../../config/redis.js';
import mongoose from 'mongoose';

export class DlqService {
  private static instance: DlqService;

  public static readonly DEFAULT_DLQ_NAME = 'taskflow-dlq';

  private constructor() {}

  public static getInstance(): DlqService {
    if (!DlqService.instance) {
      DlqService.instance = new DlqService();
    }
    return DlqService.instance;
  }

  /**
   * Quarantines a permanently failed or poison-pill job into the Dead-Letter Queue.
   * Guarantees idempotency: repeated failure events cannot create duplicate DLQ entries.
   */
  public async quarantineJob(
    mongoJob: IJobDocument,
    error: Error,
    durationMs: number
  ): Promise<void> {
    // 1. Idempotency check: skip if already marked as DEAD_LETTER
    if (mongoJob.status === JobStatus.DEAD_LETTER) {
      logger.info(`Job '${mongoJob.jobId}' is already in DEAD_LETTER status. Skipping duplicate quarantine.`);
      return;
    }

    const sanitizedMessage = sanitizePayload(error.message);
    const errorCode = (error as { code?: string }).code || 'DEAD_LETTER_QUARANTINED';

    const errorDetails = {
      message: sanitizedMessage,
      stack: error.stack,
      code: errorCode,
      failedAt: new Date(),
    };

    // 2. Atomic state transition in MongoDB ensuring only one quarantine operation succeeds
    const updatedJob = await JobModel.findOneAndUpdate(
      {
        _id: mongoJob._id,
        status: { $ne: JobStatus.DEAD_LETTER },
      },
      {
        $set: {
          status: JobStatus.DEAD_LETTER,
          failedAt: new Date(),
          error: errorDetails,
        },
      },
      { new: true }
    );

    if (!updatedJob) {
      logger.info(`Job '${mongoJob.jobId}' was already transitioned to DEAD_LETTER concurrently. Skipping.`);
      return;
    }

    // Synchronize local document status
    mongoJob.status = JobStatus.DEAD_LETTER;
    mongoJob.failedAt = updatedJob.failedAt;
    mongoJob.error = errorDetails;

    // Update the last execution record if present
    const currentExec = mongoJob.executions[mongoJob.executions.length - 1];
    if (currentExec) {
      currentExec.status = 'FAILED';
      currentExec.completedAt = new Date().toISOString();
      currentExec.durationMs = durationMs;
      currentExec.errorDetails = {
        message: errorDetails.message,
        stack: errorDetails.stack,
        code: errorDetails.code,
      };
      currentExec.logs.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Job exhausted all ${mongoJob.maxAttempts} attempts. Quarantined to Dead-Letter Queue. Reason: ${sanitizedMessage}`,
      });
      await JobModel.updateOne(
        { _id: mongoJob._id },
        { $set: { executions: mongoJob.executions } }
      );
    }

    // 3. Mirror quarantined record into BullMQ DLQ with deterministic jobId to prevent duplicates
    try {
      const redis = getRedisClient();
      if (redis.status === 'ready' || redis.status === 'connect') {
        const dlqName = `${mongoJob.queueName}-dlq` || DlqService.DEFAULT_DLQ_NAME;
        const dlq = queueService.getQueue(dlqName);
        await dlq.add(
          mongoJob.name,
          {
            originalJobId: mongoJob.jobId,
            originalQueue: mongoJob.queueName,
            error: errorDetails,
            payload: mongoJob.payload,
            attemptsMade: mongoJob.attemptsMade,
            quarantinedAt: new Date().toISOString(),
          },
          {
            jobId: `dlq_${mongoJob.jobId}`, // Deterministic BullMQ ID prevents duplicate DLQ records
            removeOnComplete: 1000,
            removeOnFail: false,
          }
        );
        logger.error(
          `Job '${mongoJob.jobId}' quarantined to DLQ '${dlqName}' after ${mongoJob.attemptsMade} failed attempts.`
        );
      }
    } catch (dlqErr) {
      logger.warn(`Failed to mirror quarantined job '${mongoJob.jobId}' into BullMQ DLQ:`, dlqErr);
    }
  }

  /**
   * Manually redrives a quarantined DEAD_LETTER or FAILED job back into active processing.
   * Atomic state transitions prevent concurrent redrive requests from racing.
   * State is restored to previous status if Redis enqueueing fails.
   */
  public async redriveJob(
    identifier: string,
    operatorUserId: string,
    operatorRole: UserRole = UserRole.DEVELOPER
  ): Promise<IJobDocument> {
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

    // Ownership check for non-admin operators
    const userObj = job.userId as unknown as { _id?: mongoose.Types.ObjectId | string };
    const jobOwnerId = userObj?._id ? userObj._id.toString() : job.userId.toString();

    if (operatorRole !== UserRole.ADMIN && jobOwnerId !== operatorUserId) {
      throw new AppError('Access forbidden: You do not have permission to redrive this job', 403, 'FORBIDDEN');
    }

    if (job.status !== JobStatus.DEAD_LETTER && job.status !== JobStatus.FAILED) {
      throw new AppError(
        `Job '${job.jobId}' cannot be redriven from current status '${job.status}'. Only DEAD_LETTER or FAILED jobs can be redriven.`,
        400,
        'BAD_REQUEST'
      );
    }

    const previousStatus = job.status;
    const previousAttempts = job.attemptsMade;

    // Atomically claim redrive transition (prevents concurrent redrives from racing!)
    const claimedJob = await JobModel.findOneAndUpdate(
      {
        _id: job._id,
        status: { $in: [JobStatus.DEAD_LETTER, JobStatus.FAILED] },
      },
      {
        $set: {
          status: JobStatus.QUEUED,
          attemptsMade: 0,
          progress: 0,
        },
        $unset: {
          error: 1,
          completedAt: 1,
          failedAt: 1,
          cancelledAt: 1,
          scheduledAt: 1,
        },
      },
      { new: true }
    );

    if (!claimedJob) {
      throw new AppError(
        `Job '${job.jobId}' is currently being redriven or is no longer in DEAD_LETTER / FAILED state.`,
        409,
        'CONFLICT'
      );
    }

    // Remove any stale BullMQ job from Redis so old and new jobs cannot execute concurrently
    try {
      const redis = getRedisClient();
      if (redis.status === 'ready' || redis.status === 'connect') {
        const q = queueService.getQueue(claimedJob.queueName || 'default');
        const existingBullJob = await q.getJob(claimedJob.bullJobId || claimedJob.jobId);
        if (existingBullJob) {
          await existingBullJob.remove();
          logger.info(`Removed stale BullMQ job '${existingBullJob.id}' prior to redrive.`);
        }
      }
    } catch (removeErr) {
      logger.warn(`Could not remove stale BullMQ job before redrive:`, removeErr);
    }

    // Append audit log to execution history
    const redriveLog = {
      attemptNumber: (claimedJob.executions.length || 0) + 1,
      workerId: 'dlq-redrive-controller',
      status: 'PROCESSING' as const,
      startedAt: new Date().toISOString(),
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: 'info' as const,
          message: `Job redriven manually from ${previousStatus} by operator '${operatorUserId}'`,
        },
      ],
    };
    claimedJob.executions.push(redriveLog);

    // Re-dispatch into primary BullMQ queue with atomic state rollback on Redis interruption
    try {
      const bullJobId = await queueService.addJob(claimedJob);
      claimedJob.bullJobId = bullJobId;
      await claimedJob.save();
    } catch (redisErr) {
      // Revert MongoDB status back to previous dead-letter/failed state to preserve consistency
      claimedJob.status = previousStatus;
      claimedJob.attemptsMade = previousAttempts;
      claimedJob.failedAt = new Date();
      claimedJob.error = {
        message: `Redrive failed due to queue infrastructure error: ${(redisErr as Error).message}`,
        failedAt: new Date(),
      };
      await claimedJob.save();
      logger.error(
        `Redis failure during redrive of job '${claimedJob.jobId}'. State restored to ${previousStatus}:`,
        redisErr
      );
      throw new AppError(
        `Failed to enqueue redriven job to Redis: ${(redisErr as Error).message}`,
        503,
        'SERVICE_UNAVAILABLE'
      );
    }

    logger.info(`Job '${claimedJob.jobId}' successfully redriven into queue '${claimedJob.queueName}' by operator '${operatorUserId}'.`);
    return claimedJob;
  }

  /**
   * Bulk redrives all dead-letter jobs, optionally scoped to a single queue.
   */
  public async bulkRedrive(
    queueName?: string,
    operatorUserId: string = 'system',
    operatorRole: UserRole = UserRole.ADMIN
  ): Promise<{ redrivenCount: number; jobIds: string[] }> {
    const cleanQueueName =
      typeof queueName === 'string' && queueName.trim().length > 0 ? queueName.trim() : undefined;

    const filter: Record<string, unknown> = {
      status: { $in: [JobStatus.DEAD_LETTER, JobStatus.FAILED] },
    };

    if (cleanQueueName) {
      filter.queueName = cleanQueueName;
    }

    // Non-admin can only redrive their own jobs
    if (operatorRole !== UserRole.ADMIN) {
      filter.userId = mongoose.Types.ObjectId.isValid(operatorUserId)
        ? new mongoose.Types.ObjectId(operatorUserId)
        : operatorUserId;
    }

    const deadLetterJobs = await JobModel.find(filter).select('_id jobId');
    const redrivenIds: string[] = [];

    for (const j of deadLetterJobs) {
      try {
        await this.redriveJob(j._id.toString(), operatorUserId, operatorRole);
        redrivenIds.push(j.jobId);
      } catch (err) {
        logger.warn(`Failed to redrive dead-letter job '${j.jobId}' during bulk operation:`, err);
      }
    }

    logger.info(`Bulk DLQ redrive completed: ${redrivenIds.length} jobs rescheduled.`);
    return {
      redrivenCount: redrivenIds.length,
      jobIds: redrivenIds,
    };
  }

  /**
   * Returns aggregated statistics of dead-letter jobs across queues.
   */
  public async getDlqStats(userRole: UserRole, userId: string): Promise<{
    totalDeadLetters: number;
    byQueue: Record<string, number>;
  }> {
    const matchFilter: Record<string, unknown> = {
      status: JobStatus.DEAD_LETTER,
    };

    if (userRole !== UserRole.ADMIN) {
      matchFilter.userId = mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : userId;
    }

    const aggregated = await JobModel.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$queueName', count: { $sum: 1 } } },
    ]);

    const byQueue: Record<string, number> = {};
    let totalDeadLetters = 0;

    for (const item of aggregated) {
      byQueue[item._id] = item.count;
      totalDeadLetters += item.count;
    }

    return { totalDeadLetters, byQueue };
  }
}

export const dlqService = DlqService.getInstance();
