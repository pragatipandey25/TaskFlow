import { Router } from 'express';
import { JobController } from './job.controller.js';
import { authenticateJwt } from '../../core/middleware/auth.middleware.js';
import { requireRole } from '../../core/middleware/rbac.middleware.js';
import { asyncHandler } from '../../core/middleware/async-handler.js';
import { UserRole } from '@taskflow/shared';

const router = Router();

// All job endpoints require authenticated sessions
router.use(authenticateJwt);

// Submit new job (Developers and Admins only)
router.post(
  '/',
  requireRole(UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(JobController.submitJob)
);

// List jobs (Viewers, Developers, and Admins)
router.get(
  '/',
  requireRole(UserRole.VIEWER, UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(JobController.listJobs)
);

// Get Dead-Letter Queue summary statistics
router.get(
  '/dlq/stats',
  requireRole(UserRole.VIEWER, UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(JobController.getDlqStats)
);

// Bulk redrive dead-letter jobs (Developers and Admins)
router.post(
  '/dlq/redrive-all',
  requireRole(UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(JobController.bulkRedrive)
);

// Get specific job details and execution history
router.get(
  '/:id',
  requireRole(UserRole.VIEWER, UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(JobController.getJobById)
);

// Cancel in-flight or queued job
router.post(
  '/:id/cancel',
  requireRole(UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(JobController.cancelJob)
);

// Retry / redrive failed or dead-letter job
router.post(
  '/:id/retry',
  requireRole(UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(JobController.retryJob)
);

export const jobRoutes = router;
