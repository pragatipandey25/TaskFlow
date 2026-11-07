import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { authenticateJwt } from '../../core/middleware/auth.middleware.js';
import { authRateLimiter } from '../../core/middleware/rate-limiter.middleware.js';
import { asyncHandler } from '../../core/middleware/async-handler.js';

export const authRouter = Router();

// Public Authentication endpoints with rate limiting
authRouter.post('/register', authRateLimiter, asyncHandler(AuthController.register));
authRouter.post('/login', authRateLimiter, asyncHandler(AuthController.login));
authRouter.post('/refresh', authRateLimiter, asyncHandler(AuthController.refresh));
authRouter.post('/logout', asyncHandler(AuthController.logout));

// Protected Authentication endpoints
authRouter.get('/me', authenticateJwt, asyncHandler(AuthController.getMe));
