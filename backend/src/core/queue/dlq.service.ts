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
   */
  public async quarantineJob(
    mongoJob: IJobDocument,
    error: Error,
    durationMs: number
  ): Promise<void> {
    const sanitizedMessage = sanitizePayload(error.message);
    const errorCode = (error as { code?: string }).code || 'DEAD_LETTER_QUARANTINED';

    const errorDetails = {
      message: sanitizedMessage,
      stack: error.stack,
      code: errorCode,
      failedAt: new Date(),
    };

    mongoJob.status = JobStatus.DEAD_LETTER;
    mongoJob.failedAt = new Date();
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
    }

    await mongoJob.save();

    // Mirror quarantined record into BullMQ DLQ for queue-level inspection if Redis is connected
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
            jobId: `dlq_${mongoJob.jobId}_${Date.now()}`,
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
    if (operatorRole !== UserRole.ADMIN && job.userId.toString() !== operatorUserId) {
      throw new AppError('Access forbidden: You do not have permission to redrive this job', 403, 'FORBIDDEN');
    }

    if (job.status !== JobStatus.DEAD_LETTER && job.status !== JobStatus.FAILED) {
      throw new AppError(
        `Job '${job.jobId}' cannot be redriven from current status '${job.status}'. Only DEAD_LETTER or FAILED jobs can be redriven.`,
        400,
        'BAD_REQUEST'
      );
    }

    // Reset attempt counter & error state for fresh execution
    job.attemptsMade = 0;
    job.status = JobStatus.QUEUED;
    job.progress = 0;
    job.set('error', undefined);
    job.completedAt = undefined;
    job.failedAt = undefined;
    job.cancelledAt = undefined;
    job.scheduledAt = undefined;

    // Append audit log to execution history
    const redriveLog = {
      attemptNumber: (job.executions.length || 0) + 1,
      workerId: 'dlq-redrive-controller',
      status: 'PROCESSING' as const,
      startedAt: new Date().toISOString(),
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: 'info' as const,
          message: `Job redriven manually from DEAD_LETTER by operator '${operatorUserId}'`,
        },
      ],
    };
    job.executions.push(redriveLog);

    // Re-dispatch into primary BullMQ queue
    const bullJobId = await queueService.addJob(job);
    job.bullJobId = bullJobId;
    await job.save();

    logger.info(`Job '${job.jobId}' successfully redriven into queue '${job.queueName}' by operator '${operatorUserId}'.`);
    return job;
  }

  /**
   * Bulk redrives all dead-letter jobs, optionally scoped to a single queue.
   */
  public async bulkRedrive(
    queueName?: string,
    operatorUserId: string = 'system',
    operatorRole: UserRole = UserRole.ADMIN
  ): Promise<{ redrivenCount: number; jobIds: string[] }> {
    const filter: Record<string, unknown> = {
      status: { $in: [JobStatus.DEAD_LETTER, JobStatus.FAILED] },
    };

    if (queueName) {
      filter.queueName = queueName;
    }

    // Non-admin can only redrive their own jobs
    if (operatorRole !== UserRole.ADMIN) {
      filter.userId = new mongoose.Types.ObjectId(operatorUserId);
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
      matchFilter.userId = new mongoose.Types.ObjectId(userId);
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
