import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.config.js';
import { requestLogger } from './core/middleware/request-logger.middleware.js';
import { notFoundHandler } from './core/middleware/not-found.middleware.js';
import { errorHandler } from './core/errors/error-handler.middleware.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';

export function createApp(): Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Correlation-Id',
        'Idempotency-Key',
      ],
    })
  );

  // Cookie parsing for HttpOnly refresh tokens
  app.use(cookieParser());

  // Body parsing middlewares
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Correlation ID and request logging
  app.use(requestLogger);

  // API Routes
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);

  // 404 Handler
  app.use(notFoundHandler);

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
