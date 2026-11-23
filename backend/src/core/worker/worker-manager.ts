import { Worker, Job as BullJob } from 'bullmq';
import { getRedisConnectionOptions } from '../../config/redis.js';
import { env } from '../../config/env.config.js';
import { logger } from '../logging/logger.js';
import { JobModel } from '../../models/job.model.js';
import { processorRegistry } from './processor.registry.js';
import { JobStatus, JobExecutionRecord } from '@taskflow/shared';
import { sanitizePayload } from '../logging/log-sanitizer.js';
import { backoffService } from '../queue/backoff.service.js';
import { dlqService } from '../queue/dlq.service.js';
import { AppError } from '../errors/app-error.js';

export class WorkerManager {
  private static instance: WorkerManager;
  private workers = new Map<string, Worker>();
  private workerId: string;
  private activeJobs = new Set<string>();
  private activeAbortControllers = new Map<string, AbortController>();

  private constructor() {
    this.workerId = `worker-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
  }

  public static getInstance(): WorkerManager {
    if (!WorkerManager.instance) {
      WorkerManager.instance = new WorkerManager();
    }
    return WorkerManager.instance;
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  public getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  public getActiveJobIds(): string[] {
    return Array.from(this.activeJobs);
  }

  public getQueuesSubscribed(): string[] {
    return Array.from(this.workers.keys());
  }

  public isJobActive(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }

  /**
   * Cooperatively dispatches an AbortSignal to a currently executing in-flight job.
   */
  public cancelActiveJob(jobId: string, reason?: string): boolean {
    const controller = this.activeAbortControllers.get(jobId);
    if (controller) {
      controller.abort(reason || 'Job cancelled by operator request');
      logger.info(`Dispatched cooperative AbortSignal to active job '${jobId}'.`);
      return true;
    }
    return false;
  }

  /**
   * Spawns a BullMQ worker for the specified queue with configured concurrency and watchdog intervals.
   */
  public startWorker(queueName: string = env.DEFAULT_QUEUE_NAME): Worker {
    if (this.workers.has(queueName)) {
      return this.workers.get(queueName)!;
    }

    const connection = getRedisConnectionOptions();

    const worker = new Worker(
      queueName,
      async (bullJob: BullJob) => {
        return this.processJob(bullJob);
      },
      {
        connection,
        concurrency: env.WORKER_CONCURRENCY,
        lockDuration: env.WORKER_LOCK_DURATION_MS,
        stalledInterval: env.WORKER_STALLED_INTERVAL_MS,
        maxStalledCount: env.WORKER_MAX_STALLED_COUNT,
        settings: {
          backoffStrategy: (attemptsMade, type, _err, bullJob) => {
            const jobBackoff = bullJob?.opts?.backoff as { type?: string; delay?: number } | undefined;
            return backoffService.calculateBackoff(attemptsMade, {
              type: (type as 'exponential' | 'fixed') || (jobBackoff?.type as 'exponential' | 'fixed') || 'exponential',
              delayMs: jobBackoff?.delay || 1000,
              jitter: true,
            });
          },
        },
      }
    );

    worker.on('active', (bullJob) => {
      logger.info(`Worker [${this.workerId}] ACTIVE: Job ${bullJob.id} (${bullJob.name})`);
    });

    worker.on('completed', (bullJob) => {
      logger.info(`Worker [${this.workerId}] COMPLETED: Job ${bullJob.id} (${bullJob.name})`);
    });

    worker.on('failed', (bullJob, err) => {
      logger.warn(`Worker [${this.workerId}] FAILED: Job ${bullJob?.id} - Error: ${err.message}`);
    });

    worker.on('error', (err) => {
      logger.error(`Worker [${this.workerId}] error on queue '${queueName}':`, err);
    });

    this.workers.set(queueName, worker);
    logger.info(
      `Started BullMQ Worker [${this.workerId}] on queue '${queueName}' with concurrency ${env.WORKER_CONCURRENCY}`
    );

    return worker;
  }

  /**
   * Core processing engine for a single BullMQ job.
   */
  public async processJob(bullJob: BullJob): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const jobId = String(bullJob.data.jobId || bullJob.id);

    this.activeJobs.add(jobId);
    const abortController = new AbortController();
    this.activeAbortControllers.set(jobId, abortController);

    try {
      // 1. Fetch Job from MongoDB
      const mongoJob = await JobModel.findOne({ jobId });
      if (!mongoJob) {
        logger.warn(`Job document '${jobId}' not found in MongoDB. Skipping processing.`);
        return { skipped: true, reason: 'Job document missing in MongoDB' };
      }

      // 2. Abort if job was already cancelled
      if (mongoJob.status === JobStatus.CANCELLED) {
        logger.info(`Job '${jobId}' was cancelled before worker execution.`);
        return { skipped: true, reason: 'Job already cancelled' };
      }

      // 3. Mark job as PROCESSING
      const currentAttempt = (mongoJob.attemptsMade || 0) + 1;
      mongoJob.status = JobStatus.PROCESSING;
      mongoJob.lockedBy = this.workerId;
      mongoJob.attemptsMade = currentAttempt;
      if (!mongoJob.startedAt) {
        mongoJob.startedAt = new Date();
      }

      const queueWaitTimeMs = mongoJob.createdAt
        ? Math.max(0, startTime - new Date(mongoJob.createdAt).getTime())
        : 0;

      const executionRecord: JobExecutionRecord = {
        attemptNumber: currentAttempt,
        workerId: this.workerId,
        status: 'PROCESSING',
        startedAt: new Date().toISOString(),
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Worker ${this.workerId} started execution (Attempt ${currentAttempt}/${mongoJob.maxAttempts}, waitTime: ${queueWaitTimeMs}ms)`,
          },
        ],
      };
      mongoJob.executions.push(executionRecord);
      await mongoJob.save();

      // 4. Progress Updater Hook with cooperative cancellation check
      const updateProgress = async (percentage: number, logMessage?: string) => {
        try {
          if (abortController.signal.aborted) {
            throw new AppError(
              `Job '${jobId}' was cancelled during execution. Aborting further processing.`,
              499,
              'JOB_CANCELLED'
            );
          }

          // Check if status in MongoDB was changed to CANCELLED concurrently
          const currentDoc = await JobModel.findOne({ jobId }).select('status');
          if (currentDoc && currentDoc.status === JobStatus.CANCELLED) {
            abortController.abort('Job marked as cancelled in database');
            throw new AppError(
              `Job '${jobId}' was marked CANCELLED in database during execution.`,
              499,
              'JOB_CANCELLED'
            );
          }

          await bullJob.updateProgress(percentage);
          mongoJob.progress = percentage;
          if (logMessage) {
            const sanitizedLog = sanitizePayload(logMessage);
            const currentExec = mongoJob.executions[mongoJob.executions.length - 1];
            if (currentExec) {
              currentExec.logs.push({
                timestamp: new Date().toISOString(),
                level: 'info',
                message: sanitizedLog,
              });
            }
          }
          await mongoJob.save();
        } catch (err) {
          if ((err as { code?: string }).code === 'JOB_CANCELLED') {
            throw err;
          }
          logger.warn(`Failed to update progress for job '${jobId}':`, err);
        }
      };

      // 5. Execute Processor Handler
      try {
        const processor = processorRegistry.get(mongoJob.type);
        if (!processor) {
          throw new Error(
            `No registered processor found for job type '${mongoJob.type}'. Registered types: [${processorRegistry.getRegisteredTypes().join(', ')}]`
          );
        }

        const rawResult = await processor.process(mongoJob, updateProgress, abortController.signal);
        const durationMs = Date.now() - startTime;
        const result = sanitizePayload(rawResult) as Record<string, unknown>;

        // 6. Check if cancelled before writing COMPLETED state
        if (abortController.signal.aborted) {
          logger.info(`Job '${jobId}' was cancelled during processing. Preserving CANCELLED state.`);
          return { cancelled: true, reason: 'Job cancelled during execution' };
        }

        // Atomically update MongoDB to COMPLETED only if status is NOT CANCELLED
        const completedJob = await JobModel.findOneAndUpdate(
          { jobId, status: { $ne: JobStatus.CANCELLED } },
          {
            $set: {
              status: JobStatus.COMPLETED,
              progress: 100,
              completedAt: new Date(),
              result,
              'executions.$[elem].status': 'COMPLETED',
              'executions.$[elem].completedAt': new Date().toISOString(),
              'executions.$[elem].durationMs': durationMs,
            },
          },
          {
            arrayFilters: [{ 'elem.attemptNumber': currentAttempt }],
            new: true,
          }
        );

        if (!completedJob) {
          logger.info(`Job '${jobId}' was cancelled concurrently before completion. COMPLETED state avoided.`);
          return { cancelled: true, reason: 'Job cancelled concurrently before completion' };
        }

        return result;
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const error = err instanceof Error ? err : new Error(String(err));
        const sanitizedMessage = sanitizePayload(error.message);

        // Check if cancellation caused this failure or occurred concurrently
        const isCancelled =
          abortController.signal.aborted ||
          (error as { code?: string }).code === 'JOB_CANCELLED' ||
          (await JobModel.findOne({ jobId }).select('status'))?.status === JobStatus.CANCELLED;

        if (isCancelled) {
          logger.info(`Job '${jobId}' halted due to cancellation. Skipping retries and DLQ quarantine.`);
          const latest = await JobModel.findOne({ jobId });
          if (latest && latest.status !== JobStatus.CANCELLED) {
            latest.status = JobStatus.CANCELLED;
            latest.cancelledAt = new Date();
            await latest.save();
          }
          return { cancelled: true, reason: 'Execution halted due to cancellation' };
        }

        // Evaluate Retry vs Dead-Letter Queue
        if (currentAttempt < mongoJob.maxAttempts) {
          const nextRetryDelayMs = backoffService.calculateBackoff(currentAttempt, {
            type: mongoJob.backoff?.type,
            delayMs: mongoJob.backoff?.delayMs,
            jitter: true,
          });

          mongoJob.status = JobStatus.RETRYING;
          mongoJob.scheduledAt = new Date(Date.now() + nextRetryDelayMs);

          const errorDetails = {
            message: sanitizedMessage,
            stack: error.stack,
            code: (error as { code?: string }).code || 'JOB_EXECUTION_FAILURE',
            failedAt: new Date(),
          };

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
              message: `Attempt ${currentAttempt} failed: ${sanitizedMessage}. Next retry scheduled in ${nextRetryDelayMs}ms with jitter.`,
            });
          }

          mongoJob.error = errorDetails;
          await mongoJob.save();
          logger.warn(
            `Job '${jobId}' failed attempt ${currentAttempt}/${mongoJob.maxAttempts}. State set to RETRYING with ${nextRetryDelayMs}ms backoff delay.`
          );
        } else {
          // Exhausted all attempts -> Route to Dead-Letter Queue
          await dlqService.quarantineJob(mongoJob, error, durationMs);
        }

        // Re-throw so BullMQ handles backoff delay or moves to failed state
        throw error;
      }
    } finally {
      this.activeAbortControllers.delete(jobId);
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Graceful worker shutdown: pauses intake, allows active jobs to finish, then closes workers.
   */
  public async shutdown(): Promise<void> {
    logger.info(`Shutting down WorkerManager [PID: ${process.pid}]...`);

    // 1. Pause all workers from accepting new jobs
    for (const [name, worker] of this.workers.entries()) {
      try {
        await worker.pause(true);
        logger.info(`Worker paused on queue '${name}'`);
      } catch (err) {
        logger.warn(`Error pausing worker on '${name}':`, err);
      }
    }

    // 2. Close workers
    for (const [name, worker] of this.workers.entries()) {
      try {
        await worker.close();
        logger.info(`Worker closed on queue '${name}'`);
      } catch (err) {
        logger.error(`Error closing worker on '${name}':`, err);
      }
    }

    this.workers.clear();
    logger.info('All background workers stopped gracefully');
  }
}

export const workerManager = WorkerManager.getInstance();
