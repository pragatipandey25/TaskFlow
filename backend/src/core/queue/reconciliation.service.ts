import { JobModel } from '../../models/job.model.js';
import { JobStatus } from '@taskflow/shared';
import { queueService } from './queue.service.js';
import { logger } from '../logging/logger.js';

export interface ReconciliationSummary {
  inspected: number;
  reconciled: number;
  failed: number;
}

export class JobReconciliationService {
  private static instance: JobReconciliationService;
  private intervalHandle: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): JobReconciliationService {
    if (!JobReconciliationService.instance) {
      JobReconciliationService.instance = new JobReconciliationService();
    }
    return JobReconciliationService.instance;
  }

  /**
   * Scans for jobs stuck in PENDING status due to Redis outages during initial submission
   * and attempts to re-enqueue them to BullMQ.
   */
  public async reconcilePendingJobs(olderThanMs: number = 10000): Promise<ReconciliationSummary> {
    const cutoffDate = new Date(Date.now() - olderThanMs);
    const summary: ReconciliationSummary = {
      inspected: 0,
      reconciled: 0,
      failed: 0,
    };

    try {
      const pendingJobs = await JobModel.find({
        status: JobStatus.PENDING,
        createdAt: { $lte: cutoffDate },
      }).limit(50);

      summary.inspected = pendingJobs.length;
      if (pendingJobs.length === 0) {
        return summary;
      }

      logger.info(
        `JobReconciliationService: Found ${pendingJobs.length} orphaned PENDING jobs to reconcile.`
      );

      for (const job of pendingJobs) {
        try {
          const bullJobId = await queueService.addJob(job);
          job.status = JobStatus.QUEUED;
          job.bullJobId = bullJobId;
          job.error = undefined;
          await job.save();
          summary.reconciled++;
          logger.info(`Reconciled and enqueued orphaned job '${job.jobId}' into BullMQ.`);
        } catch (err: unknown) {
          summary.failed++;
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.warn(`Failed to reconcile job '${job.jobId}': ${errorMsg}`);

          // If job has been orphaned for over 10 minutes and still cannot be enqueued, mark as FAILED
          const tenMinutesAgo = new Date(Date.now() - 600000);
          if (job.createdAt < tenMinutesAgo) {
            job.status = JobStatus.FAILED;
            job.error = {
              message: `Reconciliation timeout: Unable to enqueue after repeated attempts. Last error: ${errorMsg}`,
              failedAt: new Date(),
            };
            await job.save();
          }
        }
      }
    } catch (err) {
      logger.error('Error during reconciliation scan:', err);
    }

    return summary;
  }

  public startPeriodicReconciliation(intervalMs: number = 30000): void {
    if (this.intervalHandle) return;

    this.intervalHandle = setInterval(async () => {
      try {
        await this.reconcilePendingJobs();
      } catch (err) {
        logger.warn('Background job reconciliation error:', err);
      }
    }, intervalMs);

    logger.info(`Started periodic job reconciliation sweeper (every ${intervalMs}ms)`);
  }

  public stopPeriodicReconciliation(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('Stopped periodic job reconciliation sweeper');
    }
  }
}

export const jobReconciliationService = JobReconciliationService.getInstance();
