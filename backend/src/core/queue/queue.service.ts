import { Queue, JobsOptions } from 'bullmq';
import { getRedisConnectionOptions } from '../../config/redis.js';
import { env } from '../../config/env.config.js';
import { logger } from '../logging/logger.js';
import { IJobDocument } from '../../models/job.model.js';
import { eventPublisher } from '../socket/event-publisher.js';

export interface QueueStatistics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export class QueueService {
  private static instance: QueueService;
  private queues = new Map<string, Queue>();

  private constructor() {}

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  public getQueue(queueName: string = env.DEFAULT_QUEUE_NAME): Queue {
    const existing = this.queues.get(queueName);
    if (existing) {
      return existing;
    }

    const connection = getRedisConnectionOptions();
    const queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });

    queue.on('error', (err) => {
      logger.error(`BullMQ Queue [${queueName}] error:`, err);
    });

    this.queues.set(queueName, queue);
    logger.info(`Initialized BullMQ Queue: '${queueName}'`);
    return queue;
  }

  /**
   * Enqueues a job from MongoDB into BullMQ with configured priorities, delays, and backoff.
   */
  public async addJob(job: IJobDocument): Promise<string> {
    const queueName = job.queueName || env.DEFAULT_QUEUE_NAME;
    const queue = this.getQueue(queueName);

    const bullOptions: JobsOptions = {
      jobId: job.jobId,
      priority: job.priority, // BullMQ: 1 (highest) to N (lowest)
      delay: job.delayMs > 0 ? job.delayMs : undefined,
      attempts: job.maxAttempts,
      backoff: {
        type: job.backoff.type,
        delay: job.backoff.delayMs,
      },
    };

    const bullJob = await queue.add(
      job.name,
      {
        jobId: job.jobId,
        mongoId: job._id.toString(),
        userId: job.userId.toString(),
        type: job.type,
        payload: job.payload,
      },
      bullOptions
    );

    logger.info(`BullMQ Enqueued Job: '${job.name}' [BullID: ${bullJob.id}, MongoID: ${job.jobId}]`);

    // Non-blocking asynchronous queue telemetry broadcast
    this.getQueueMetrics(queueName)
      .then((metrics) => {
        return eventPublisher.publishQueueTelemetry({
          queueName,
          waiting: metrics.waiting,
          active: metrics.active,
          delayed: metrics.delayed,
          failed: metrics.failed,
          completed: metrics.completed,
          paused: metrics.paused,
          timestamp: new Date().toISOString(),
        });
      })
      .catch((err) => {
        logger.debug(`Could not publish queue telemetry after addJob: ${err.message}`);
      });

    return bullJob.id || job.jobId;
  }

  /**
   * Removes or cancels a job from the queue if waiting or delayed.
   */
  public async cancelJob(queueName: string, bullJobId: string): Promise<boolean> {
    try {
      const queue = this.getQueue(queueName);
      const bullJob = await queue.getJob(bullJobId);
      if (bullJob) {
        const state = await bullJob.getState();
        if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
          await bullJob.remove();
          logger.info(`Cancelled and removed BullMQ job ${bullJobId} from queue '${queueName}'`);
          return true;
        }
      }
      return false;
    } catch (err) {
      logger.warn(`Could not remove BullMQ job ${bullJobId}:`, err);
      return false;
    }
  }

  /**
   * Re-enqueues or retries an existing BullMQ job.
   */
  public async retryJob(queueName: string, bullJobId: string): Promise<boolean> {
    try {
      const queue = this.getQueue(queueName);
      const bullJob = await queue.getJob(bullJobId);
      if (bullJob) {
        await bullJob.retry();
        logger.info(`BullMQ job ${bullJobId} retried in queue '${queueName}'`);
        return true;
      }
      return false;
    } catch (err) {
      logger.warn(`Could not retry BullMQ job ${bullJobId}:`, err);
      return false;
    }
  }

  /**
   * Returns current statistics for the specified queue.
   */
  public async getQueueMetrics(queueName: string = env.DEFAULT_QUEUE_NAME): Promise<QueueStatistics> {
    const queue = this.getQueue(queueName);
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    const isPaused = await queue.isPaused();

    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      paused: isPaused,
    };
  }

  /**
   * Gracefully shuts down all active queue instances.
   */
  public async closeAll(): Promise<void> {
    for (const [name, queue] of this.queues.entries()) {
      try {
        await queue.close();
        logger.info(`Closed BullMQ Queue: '${name}'`);
      } catch (err) {
        logger.error(`Error closing BullMQ Queue '${name}':`, err);
      }
    }
    this.queues.clear();
  }
}

export const queueService = QueueService.getInstance();
