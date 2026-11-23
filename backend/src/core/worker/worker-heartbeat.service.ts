import os from 'os';
import { WorkerModel, IWorkerDocument } from '../../models/worker.model.js';
import { WorkerStatus, SocketEventName } from '@taskflow/shared';
import { getRedisClient } from '../../config/redis.js';
import { logger } from '../logging/logger.js';
import { eventPublisher } from '../socket/event-publisher.js';

export interface SystemMetricsSnapshot {
  rssMemoryBytes: number;
  heapUsedBytes: number;
  cpuPercent: number;
}

export class WorkerHeartbeatService {
  private static instance: WorkerHeartbeatService;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private watchdogInterval: NodeJS.Timeout | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();

  private constructor() {}

  public static getInstance(): WorkerHeartbeatService {
    if (!WorkerHeartbeatService.instance) {
      WorkerHeartbeatService.instance = new WorkerHeartbeatService();
    }
    return WorkerHeartbeatService.instance;
  }

  /**
   * Captures current Node.js process CPU and memory metrics.
   */
  public getSystemMetrics(): SystemMetricsSnapshot {
    const memory = process.memoryUsage();
    const currentCpu = process.cpuUsage(this.lastCpuUsage);
    const now = Date.now();
    const timeDeltaMs = Math.max(1, now - this.lastCpuTime);

    // Calculate approximate CPU percentage across cores
    const cpuTotalMicros = currentCpu.user + currentCpu.system;
    const cpuPercent = Number(((cpuTotalMicros / (timeDeltaMs * 1000 * os.cpus().length)) * 100).toFixed(2));

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = now;

    return {
      rssMemoryBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      cpuPercent: Math.min(100, Math.max(0, cpuPercent)),
    };
  }

  /**
   * Starts periodic heartbeat broadcasts from an active worker process.
   */
  public async startHeartbeat(
    workerId: string,
    queues: string[],
    concurrency: number,
    getActiveJobCount: () => number,
    intervalMs = 15000
  ): Promise<void> {
    const hostname = os.hostname();
    const pid = process.pid;

    // Initial Registration in MongoDB
    await WorkerModel.findOneAndUpdate(
      { workerId },
      {
        workerId,
        hostname,
        pid,
        queuesSubscribed: queues,
        concurrency,
        activeJobCount: getActiveJobCount(),
        status: WorkerStatus.HEALTHY,
        lastHeartbeat: new Date(),
        startedAt: new Date(),
        version: '1.0.0',
        systemMetrics: this.getSystemMetrics(),
      },
      { upsert: true, new: true }
    );

    logger.info(`WorkerHeartbeatService: Registered worker '${workerId}' in registry.`);

    const initialMetrics = this.getSystemMetrics();
    await eventPublisher.publishWorkerTelemetry(SocketEventName.WORKER_REGISTERED, {
      workerId,
      status: WorkerStatus.HEALTHY,
      activeJobs: getActiveJobCount(),
      concurrency,
      queues,
      lastHeartbeat: new Date().toISOString(),
      metrics: {
        memoryRssBytes: initialMetrics.rssMemoryBytes,
        heapUsedBytes: initialMetrics.heapUsedBytes,
        cpuPercent: initialMetrics.cpuPercent,
      },
    });

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      await this.sendHeartbeat(workerId, getActiveJobCount);
    }, intervalMs);
  }

  /**
   * Transmits a single heartbeat to both Redis and MongoDB.
   */
  public async sendHeartbeat(
    workerId: string,
    getActiveJobCount: () => number
  ): Promise<void> {
    const activeJobs = getActiveJobCount();
    const metrics = this.getSystemMetrics();
    const now = new Date();

    // 1. Write Heartbeat to Redis with 45s TTL (for ultra-fast distributed liveness lookups)
    try {
      const redis = getRedisClient();
      if (redis.status === 'ready' || redis.status === 'connect') {
        const heartbeatKey = `workers:${workerId}:heartbeat`;
        await redis.set(
          heartbeatKey,
          JSON.stringify({
            workerId,
            activeJobs,
            timestamp: now.toISOString(),
          }),
          'EX',
          45
        );
      }
    } catch (err) {
      logger.warn(`Failed to write heartbeat for worker '${workerId}' to Redis:`, err);
    }

    // 2. Update Worker in MongoDB
    try {
      await WorkerModel.updateOne(
        { workerId },
        {
          status: WorkerStatus.HEALTHY,
          lastHeartbeat: now,
          activeJobCount: activeJobs,
          systemMetrics: metrics,
        }
      );

      await eventPublisher.publishWorkerTelemetry(SocketEventName.WORKER_HEARTBEAT, {
        workerId,
        status: WorkerStatus.HEALTHY,
        activeJobs,
        concurrency: 0,
        queues: [],
        lastHeartbeat: now.toISOString(),
        metrics: {
          memoryRssBytes: metrics.rssMemoryBytes,
          heapUsedBytes: metrics.heapUsedBytes,
          cpuPercent: metrics.cpuPercent,
        },
      });
    } catch (err) {
      logger.warn(`Failed to update worker '${workerId}' heartbeat in MongoDB:`, err);
    }
  }

  /**
   * Marks worker as stopped/dead upon clean process termination.
   */
  public async stopHeartbeat(workerId: string): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    try {
      const redis = getRedisClient();
      if (redis.status === 'ready' || redis.status === 'connect') {
        await redis.del(`workers:${workerId}:heartbeat`);
      }
    } catch (err) {
      logger.warn(`Failed to delete Redis heartbeat key for worker '${workerId}':`, err);
    }

    try {
      await WorkerModel.updateOne(
        { workerId },
        {
          status: WorkerStatus.DEAD,
          activeJobCount: 0,
          lastHeartbeat: new Date(),
        }
      );
      logger.info(`WorkerHeartbeatService: Worker '${workerId}' marked as DEAD on shutdown.`);
      await eventPublisher.publishWorkerTelemetry(SocketEventName.WORKER_UNREGISTERED, {
        workerId,
        status: WorkerStatus.DEAD,
        activeJobs: 0,
        concurrency: 0,
        queues: [],
        lastHeartbeat: new Date().toISOString(),
      });
    } catch (err) {
      logger.error(`Error marking worker '${workerId}' as dead in MongoDB:`, err);
    }
  }

  /**
   * Scans for workers that have ceased reporting heartbeats and flags them.
   */
  public async detectStaleWorkers(staleThresholdMs = 45000): Promise<{
    degraded: number;
    dead: number;
  }> {
    const now = Date.now();
    const deadCutoff = new Date(now - staleThresholdMs);
    const degradedCutoff = new Date(now - 30000);

    const result = { degraded: 0, dead: 0 };

    try {
      // 1. Mark workers as DEAD if past deadCutoff
      const deadResult = await WorkerModel.updateMany(
        {
          status: { $in: [WorkerStatus.HEALTHY, WorkerStatus.DEGRADED] },
          lastHeartbeat: { $lt: deadCutoff },
        },
        {
          status: WorkerStatus.DEAD,
          activeJobCount: 0,
        }
      );
      result.dead = deadResult.modifiedCount;

      // 2. Mark workers as DEGRADED if between 30s and 45s
      const degradedResult = await WorkerModel.updateMany(
        {
          status: WorkerStatus.HEALTHY,
          lastHeartbeat: { $lt: degradedCutoff, $gte: deadCutoff },
        },
        {
          status: WorkerStatus.DEGRADED,
        }
      );
      result.degraded = degradedResult.modifiedCount;

      if (result.dead > 0 || result.degraded > 0) {
        logger.info(
          `Worker Watchdog: Flagged ${result.degraded} degraded and ${result.dead} dead workers.`
        );

        await eventPublisher.publishWorkerTelemetry(SocketEventName.WORKER_STATUS, {
          workerId: 'fleet',
          status: result.dead > 0 ? WorkerStatus.DEAD : WorkerStatus.DEGRADED,
          activeJobs: 0,
          concurrency: 0,
          queues: [],
          lastHeartbeat: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.error('Error during stale worker detection scan:', err);
    }

    return result;
  }

  /**
   * Starts periodic watchdog scanner for stale workers across the fleet.
   */
  public startWatchdog(intervalMs = 30000): void {
    if (this.watchdogInterval) return;

    this.watchdogInterval = setInterval(async () => {
      await this.detectStaleWorkers();
    }, intervalMs);

    logger.info(`WorkerHeartbeatService: Stale worker watchdog active (every ${intervalMs}ms).`);
  }

  public stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * Retrieves all registered worker documents.
   */
  public async getAllWorkers(): Promise<IWorkerDocument[]> {
    return WorkerModel.find().sort({ lastHeartbeat: -1 });
  }

  /**
   * Retrieves a specific worker document by workerId.
   */
  public async getWorkerById(workerId: string): Promise<IWorkerDocument | null> {
    return WorkerModel.findOne({ workerId });
  }
}

export const workerHeartbeatService = WorkerHeartbeatService.getInstance();
