import { Router } from 'express';
import { WorkerController } from './worker.controller.js';
import { authenticateJwt } from '../../core/middleware/auth.middleware.js';
import { requireRole } from '../../core/middleware/rbac.middleware.js';
import { asyncHandler } from '../../core/middleware/async-handler.js';
import { UserRole } from '@taskflow/shared';

const router = Router();

// Worker telemetry routes require authentication
router.use(authenticateJwt);

// List all workers across the fleet
router.get(
  '/',
  requireRole(UserRole.VIEWER, UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(WorkerController.listWorkers)
);

// Get specific worker telemetry and active jobs
router.get(
  '/:id',
  requireRole(UserRole.VIEWER, UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(WorkerController.getWorkerById)
);

export const workerRoutes = router;
