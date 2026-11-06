import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { APIFailureResponse, APIErrorDetail } from '@taskflow/shared';
import { AppError } from './app-error.js';
import { logger } from '../logging/logger.js';
import { env } from '../../config/env.config.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || undefined;

  // Handle known AppError
  if (err instanceof AppError) {
    const response: APIFailureResponse = {
      success: false,
      error: {
        code: err.errorCode,
        message: err.message,
        details: err.details,
        timestamp: new Date().toISOString(),
        correlationId,
      },
    };

    if (err.statusCode >= 500) {
      logger.error(`[AppError ${err.errorCode}] ${err.message}`, {
        correlationId,
        url: req.originalUrl,
        method: req.method,
        stack: err.stack,
      });
    } else {
      logger.warn(`[AppError ${err.errorCode}] ${err.message}`, {
        correlationId,
        url: req.originalUrl,
        method: req.method,
      });
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const details: APIErrorDetail[] = err.errors.map((issue) => ({
      field: issue.path.join('.'),
      issue: issue.message,
    }));

    const response: APIFailureResponse = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload or parameters',
        details,
        timestamp: new Date().toISOString(),
        correlationId,
      },
    };

    logger.warn('Request validation failed', {
      correlationId,
      url: req.originalUrl,
      details,
    });

    res.status(400).json(response);
    return;
  }

  // Catch-all for unexpected internal errors
  logger.error(`[UnhandledError] ${err.message}`, {
    correlationId,
    url: req.originalUrl,
    method: req.method,
    stack: err.stack,
  });

  const response: APIFailureResponse = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message:
        env.NODE_ENV === 'production'
          ? 'An unexpected error occurred on the server'
          : err.message,
      timestamp: new Date().toISOString(),
      correlationId,
    },
  };

  res.status(500).json(response);
}
