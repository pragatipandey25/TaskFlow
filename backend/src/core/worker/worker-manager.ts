import { Worker, Job as BullJob } from 'bullmq';
import { getRedisConnectionOptions } from '../../config/redis.js';
import { env } from '../../config/env.config.js';
import { logger } from '../logging/logger.js';
import { JobModel } from '../../models/job.model.js';
import { processorRegistry } from './processor.registry.js';
import { JobStatus, JobExecutionRecord } from '@taskflow/shared';

export class WorkerManager {
  private static instance: WorkerManager;
  private workers = new Map<string, Worker>();
  private workerId: string;

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
    const jobId = bullJob.data.jobId || bullJob.id;

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

    const executionRecord: JobExecutionRecord = {
      attemptNumber: currentAttempt,
      workerId: this.workerId,
      status: 'PROCESSING',
      startedAt: new Date().toISOString(),
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `Worker ${this.workerId} started execution (Attempt ${currentAttempt}/${mongoJob.maxAttempts})`,
        },
      ],
    };
    mongoJob.executions.push(executionRecord);
    await mongoJob.save();

    // 4. Progress Updater Hook
    const updateProgress = async (percentage: number, logMessage?: string) => {
      try {
        await bullJob.updateProgress(percentage);
        mongoJob.progress = percentage;
        if (logMessage) {
          const currentExec = mongoJob.executions[mongoJob.executions.length - 1];
          if (currentExec) {
            currentExec.logs.push({
              timestamp: new Date().toISOString(),
              level: 'info',
              message: logMessage,
            });
          }
        }
        await mongoJob.save();
      } catch (err) {
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

      const result = await processor.process(mongoJob, updateProgress);
      const durationMs = Date.now() - startTime;

      // 6. Update MongoDB on SUCCESS
      mongoJob.status = JobStatus.COMPLETED;
      mongoJob.progress = 100;
      mongoJob.completedAt = new Date();
      mongoJob.result = result;

      const currentExec = mongoJob.executions[mongoJob.executions.length - 1];
      if (currentExec) {
        currentExec.status = 'COMPLETED';
        currentExec.completedAt = new Date().toISOString();
        currentExec.durationMs = durationMs;
      }

      await mongoJob.save();
      return result;
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));

      const errorDetails = {
        message: error.message,
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
          message: `Attempt ${currentAttempt} failed: ${error.message}`,
        });
      }

      mongoJob.error = errorDetails;

      // Evaluate Retry vs Dead-Letter Queue
      if (currentAttempt < mongoJob.maxAttempts) {
        mongoJob.status = JobStatus.RETRYING;
        logger.warn(
          `Job '${jobId}' failed attempt ${currentAttempt}/${mongoJob.maxAttempts}. State set to RETRYING.`
        );
      } else {
        mongoJob.status = JobStatus.DEAD_LETTER;
        mongoJob.failedAt = new Date();
        logger.error(
          `Job '${jobId}' exhausted all ${mongoJob.maxAttempts} attempts. Quarantined to DEAD_LETTER.`
        );
      }

      await mongoJob.save();
      // Re-throw so BullMQ handles backoff delay or moves to failed state
      throw error;
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
