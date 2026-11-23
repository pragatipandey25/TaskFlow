import { Request, Response } from 'express';
import { jobService } from './job.service.js';
import {
  createJobSchema,
  listJobsQuerySchema,
  jobIdParamSchema,
  cancelJobSchema,
  bulkRedriveSchema,
} from './job.validation.js';
import { AppError, UnauthorizedError, ValidationError } from '../../core/errors/app-error.js';
import { UserRole } from '@taskflow/shared';

export class JobController {
  public static async submitJob(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required to submit jobs');
    }

    const validationResult = createJobSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError(
        'Job validation failed',
        validationResult.error.errors.map((err) => ({
          field: err.path.join('.'),
          issue: err.message,
        }))
      );
    }

    const idempotencyHeader = req.headers['idempotency-key'] as string | undefined;
    const { job, isDuplicate } = await jobService.submitJob(
      req.user.id,
      validationResult.data,
      idempotencyHeader
    );

    res.status(isDuplicate ? 200 : 201).json({
      success: true,
      data: job,
      message: isDuplicate
        ? 'Duplicate submission recognized; returning existing job record.'
        : 'Job successfully submitted and dispatched to queue.',
    });
  }

  public static async listJobs(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const queryResult = listJobsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      throw new ValidationError(
        'Invalid query parameters',
        queryResult.error.errors.map((err) => ({
          field: err.path.join('.'),
          issue: err.message,
        }))
      );
    }

    const result = await jobService.listJobs(
      req.user.id,
      req.user.role as UserRole,
      queryResult.data
    );

    res.status(200).json({
      success: true,
      data: result.jobs,
      pagination: result.pagination,
    });
  }

  public static async getJobById(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const paramResult = jobIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      throw new AppError('Invalid job ID parameter', 400, 'BAD_REQUEST');
    }

    const job = await jobService.getJobById(
      paramResult.data.id,
      req.user.id,
      req.user.role as UserRole
    );

    res.status(200).json({
      success: true,
      data: job,
    });
  }

  public static async cancelJob(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const paramResult = jobIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      throw new AppError('Invalid job ID parameter', 400, 'BAD_REQUEST');
    }

    const bodyResult = cancelJobSchema.safeParse(req.body);
    const reason = bodyResult.success ? bodyResult.data.reason : undefined;

    const job = await jobService.cancelJob(
      paramResult.data.id,
      req.user.id,
      req.user.role as UserRole,
      reason
    );

    res.status(200).json({
      success: true,
      data: job,
      message: 'Job successfully cancelled.',
    });
  }

  public static async retryJob(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const paramResult = jobIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      throw new AppError('Invalid job ID parameter', 400, 'BAD_REQUEST');
    }

    const job = await jobService.retryJob(
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

  public static async getDlqStats(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const stats = await jobService.getDlqStats(
      req.user.id,
      req.user.role as UserRole
    );

    res.status(200).json({
      success: true,
      data: stats,
    });
  }
}
