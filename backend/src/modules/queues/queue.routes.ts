import { Router } from 'express';
import { QueueController } from './queue.controller.js';
import { authenticateJwt } from '../../core/middleware/auth.middleware.js';
import { requireRole } from '../../core/middleware/rbac.middleware.js';
import { asyncHandler } from '../../core/middleware/async-handler.js';
import { UserRole } from '@taskflow/shared';

const router = Router();

// Queue monitoring & management endpoints require authentication
router.use(authenticateJwt);

// Create new queue (Admin only)
router.post(
  '/',
  requireRole(UserRole.ADMIN),
  asyncHandler(QueueController.createQueue)
);

// List all queues with job counts
router.get(
  '/',
  requireRole(UserRole.VIEWER, UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(QueueController.listQueues)
);

// Get real-time queue statistics and throughput
router.get(
  '/:id/stats',
  requireRole(UserRole.VIEWER, UserRole.DEVELOPER, UserRole.ADMIN),
  asyncHandler(QueueController.getQueueStats)
);

export const queueRoutes = router;
