import { Request, Response } from 'express';
import { workerHeartbeatService } from '../../core/worker/worker-heartbeat.service.js';
import { JobModel } from '../../models/job.model.js';
import { JobStatus, WorkerResponse } from '@taskflow/shared';
import { NotFoundError } from '../../core/errors/app-error.js';

export class WorkerController {
  /**
   * GET /api/workers
   * Retrieves telemetry and status of all registered background workers.
   */
  public static async listWorkers(_req: Request, res: Response): Promise<void> {
    const workers = await workerHeartbeatService.getAllWorkers();

    const data: WorkerResponse[] = workers.map((w) => ({
      workerId: w.workerId,
      hostname: w.hostname,
      pid: w.pid,
      queuesSubscribed: w.queuesSubscribed,
      concurrency: w.concurrency,
      activeJobCount: w.activeJobCount,
      status: w.status,
      lastHeartbeat: w.lastHeartbeat.toISOString(),
      startedAt: w.startedAt.toISOString(),
      version: w.version,
      systemMetrics: w.systemMetrics
        ? {
            rssMemoryBytes: w.systemMetrics.rssMemoryBytes,
            heapUsedBytes: w.systemMetrics.heapUsedBytes,
            cpuPercent: w.systemMetrics.cpuPercent,
          }
        : undefined,
    }));

    res.status(200).json({
      success: true,
      data,
    });
  }

  /**
   * GET /api/workers/:id
   * Retrieves detailed telemetry and currently active jobs for a specific worker.
   */
  public static async getWorkerById(req: Request, res: Response): Promise<void> {
    const id = String(req.params.id);
    const worker = await workerHeartbeatService.getWorkerById(id);

    if (!worker) {
      throw new NotFoundError(`Worker '${id}' not found`);
    }

    const currentJobs = await JobModel.find({
      lockedBy: id,
      status: JobStatus.PROCESSING,
    })
      .select('jobId name startedAt')
      .limit(20);

    const uptimeSeconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(worker.startedAt).getTime()) / 1000)
    );

    res.status(200).json({
      success: true,
      data: {
        workerId: worker.workerId,
        hostname: worker.hostname,
        pid: worker.pid,
        queuesSubscribed: worker.queuesSubscribed,
        concurrency: worker.concurrency,
        status: worker.status,
        uptimeSeconds,
        lastHeartbeat: worker.lastHeartbeat.toISOString(),
        systemMetrics: worker.systemMetrics,
        currentJobs: currentJobs.map((j) => ({
          jobId: j.jobId,
          name: j.name,
          elapsedMs: j.startedAt ? Math.max(0, Date.now() - new Date(j.startedAt).getTime()) : 0,
        })),
      },
    });
  }
}
