import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.config.js';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15-minute window
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts. Please try again after 15 minutes.',
      timestamp: new Date().toISOString(),
    },
  },
  skip: () => env.NODE_ENV === 'test', // Skip rate limiting in automated test suites
});
