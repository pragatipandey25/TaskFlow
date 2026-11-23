import { Router } from 'express';
import { DlqController } from './dlq.controller.js';
import { authenticateJwt } from '../../core/middleware/auth.middleware.js';
import { requireRole } from '../../core/middleware/rbac.middleware.js';
import { asyncHandler } from '../../core/middleware/async-handler.js';
import { UserRole } from '@taskflow/shared';

const router = Router();

router.use(authenticateJwt);

// Get DLQ statistics (viewers, developers, admins)
router.get(
  '/stats',
  requireRole(UserRole.VIEWER, UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(DlqController.getDlqStats)
);

// Bulk redrive dead-letter jobs (developers, admins)
router.post(
  '/redrive-all',
  requireRole(UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(DlqController.bulkRedrive)
);

// Single redrive (developers, admins)
router.post(
  '/:id/retry',
  requireRole(UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(DlqController.redriveSingle)
);

export const dlqRoutes = router;
