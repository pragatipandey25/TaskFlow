import { Router } from 'express';
import { HealthController } from './health.controller.js';

export const healthRouter = Router();

// Liveness check (checks that Express app is running and responding)
healthRouter.get('/', HealthController.getLiveness);

// Readiness check (checks MongoDB and Redis infrastructure dependencies)
healthRouter.get('/ready', HealthController.getReadiness);
