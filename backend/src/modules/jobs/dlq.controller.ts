import { Request, Response } from 'express';
import { jobService } from './job.service.js';
import { dlqService } from '../../core/queue/dlq.service.js';
import { bulkRedriveSchema, jobIdParamSchema } from './job.validation.js';
import { AppError, UnauthorizedError } from '../../core/errors/app-error.js';
import { UserRole } from '@taskflow/shared';

export class DlqController {
  /**
   * Bulk redrives dead-letter jobs with strict user-scoping and authorization.
   */
  public static async bulkRedrive(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const bodyResult = bulkRedriveSchema.safeParse(req.body || {});
    const queryResult = bulkRedriveSchema.safeParse(req.query || {});
    const queueName =
      bodyResult.success && bodyResult.data.queueName
        ? bodyResult.data.queueName
        : queryResult.success && queryResult.data.queueName
          ? queryResult.data.queueName
          : undefined;

    const result = await jobService.bulkRedrive(
      req.user.id,
      req.user.role as UserRole,
      queueName
    );

    res.status(200).json({
      success: true,
      data: result,
      message: `Successfully rescheduled ${result.redrivenCount} dead-letter jobs.`,
    });
  }

  /**
   * Retrieves aggregated DLQ statistics scoped by user role.
   */
  public static async getDlqStats(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const stats = await dlqService.getDlqStats(
      req.user.role as UserRole,
      req.user.id
    );

    res.status(200).json({
      success: true,
      data: stats,
    });
  }

  /**
   * Redrives a single dead-letter job with ownership check.
   */
  public static async redriveSingle(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const paramResult = jobIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      throw new AppError('Invalid job ID parameter', 400, 'BAD_REQUEST');
    }

    const job = await dlqService.redriveJob(
      paramResult.data.id,
      req.user.id,
      req.user.role as UserRole
    );

    res.status(200).json({
      success: true,
      data: job,
      message: 'Job successfully redriven into queue.',
    });
  }
}
