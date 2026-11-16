import { Request, Response } from 'express';
import { QueueModel, QueueStatus } from '../../models/queue.model.js';
import { JobModel } from '../../models/job.model.js';
import { queueService } from '../../core/queue/queue.service.js';
import { env } from '../../config/env.config.js';
import { createQueueSchema } from './queue.validation.js';
import {
  ValidationError,
  ConflictError,
  UnauthorizedError,
} from '../../core/errors/app-error.js';
import { JobStatus } from '@taskflow/shared';

export class QueueController {
  /**
   * POST /api/queues
   * Create a new queue definition and initialize BullMQ queue (Admin only).
   */
  public static async createQueue(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const validation = createQueueSchema.safeParse(req.body);
    if (!validation.success) {
      throw new ValidationError(
        'Invalid queue configuration',
        validation.error.errors.map((err) => ({
          field: err.path.join('.'),
          issue: err.message,
        }))
      );
    }

    const { name, description, defaultPriority, maxConcurrency, rateLimit } = validation.data;

    const existing = await QueueModel.findOne({ name });
    if (existing) {
      throw new ConflictError(`Queue '${name}' already exists`);
    }

    const queueDoc = await QueueModel.create({
      name,
      description,
      defaultPriority,
      maxConcurrency,
      rateLimit,
      status: QueueStatus.ACTIVE,
      createdBy: req.user.id,
    });

    // Initialize BullMQ Queue instance
    queueService.getQueue(name);

    res.status(201).json({
      success: true,
      data: {
        id: queueDoc._id.toString(),
        name: queueDoc.name,
        status: queueDoc.status,
        maxConcurrency: queueDoc.maxConcurrency,
        createdAt: queueDoc.createdAt.toISOString(),
      },
    });
  }

  /**
   * GET /api/queues
   * Lists all queues with real-time job counts.
   */
  public static async listQueues(_req: Request, res: Response): Promise<void> {
    let queues = await QueueModel.find().sort({ createdAt: -1 });

    // Seed default queue if no queues defined yet
    if (queues.length === 0) {
      const defaultQueue = await QueueModel.findOneAndUpdate(
        { name: env.DEFAULT_QUEUE_NAME },
        {
          name: env.DEFAULT_QUEUE_NAME,
          description: 'Primary default background job queue',
          defaultPriority: 5,
          maxConcurrency: env.WORKER_CONCURRENCY,
          status: QueueStatus.ACTIVE,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      queues = [defaultQueue];
    }

    const data = await Promise.all(
      queues.map(async (q) => {
        let counts = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
        try {
          const metrics = await queueService.getQueueMetrics(q.name);
          counts = {
            waiting: metrics.waiting,
            active: metrics.active,
            delayed: metrics.delayed,
            failed: metrics.failed,
            completed: metrics.completed,
          };
        } catch {
          // Fallback to genuine 0 counts if queue not yet initialized
        }

        return {
          id: q._id.toString(),
          name: q.name,
          description: q.description,
          status: q.status,
          maxConcurrency: q.maxConcurrency,
          jobCounts: counts,
          createdAt: q.createdAt?.toISOString(),
        };
      })
    );

    res.status(200).json({
      success: true,
      data,
    });
  }

  /**
   * GET /api/queues/:id/stats
   * Real-time metrics snapshot, throughput, and estimated wait time.
   */
  public static async getQueueStats(req: Request, res: Response): Promise<void> {
    const id = String(req.params.id);

    // Support lookup by MongoDB _id or queue name
    let queueDoc = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      queueDoc = await QueueModel.findById(id);
    }
    if (!queueDoc) {
      queueDoc = await QueueModel.findOne({ name: id });
    }

    const queueName = queueDoc ? queueDoc.name : id;
    const queueId = queueDoc ? queueDoc._id.toString() : id;
    const maxConcurrency = queueDoc ? queueDoc.maxConcurrency : env.WORKER_CONCURRENCY;

    let counts = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: false };
    try {
      counts = await queueService.getQueueMetrics(queueName);
    } catch {
      // Fallback
    }

    // 60-second throughput from MongoDB records
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const [completedLastMinute, failedLastMinute] = await Promise.all([
      JobModel.countDocuments({
        queueName,
        status: JobStatus.COMPLETED,
        completedAt: { $gte: oneMinuteAgo },
      }),
      JobModel.countDocuments({
        queueName,
        status: { $in: [JobStatus.FAILED, JobStatus.DEAD_LETTER] },
        failedAt: { $gte: oneMinuteAgo },
      }),
    ]);

    // Calculate estimated wait time: (waiting / concurrency) * avg execution (approx 1000ms)
    const estimatedWaitTimeMs =
      counts.waiting > 0 ? Math.round((counts.waiting / Math.max(1, maxConcurrency)) * 1000) : 0;

    res.status(200).json({
      success: true,
      data: {
        queueId,
        name: queueName,
        isPaused: counts.paused,
        counts: {
          waiting: counts.waiting,
          active: counts.active,
          delayed: counts.delayed,
          failed: counts.failed,
          completed: counts.completed,
        },
        throughput: {
          completedLastMinute,
          failedLastMinute,
        },
        estimatedWaitTimeMs,
      },
    });
  }
}
