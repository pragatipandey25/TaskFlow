import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../logging/logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Use existing correlation ID or generate a new one
  const correlationId = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();
  req.headers['x-correlation-id'] = correlationId;
  res.setHeader('x-correlation-id', correlationId);

  const startHrTime = process.hrtime();

  res.on('finish', () => {
    const elapsedHrTime = process.hrtime(startHrTime);
    const elapsedMs = (elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6).toFixed(2);
    const { statusCode } = res;

    const logData = {
      correlationId,
      method: req.method,
      url: req.originalUrl,
      status: statusCode,
      durationMs: Number(elapsedMs),
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    if (statusCode >= 500) {
      logger.error(`${req.method} ${req.originalUrl} ${statusCode} - ${elapsedMs}ms`, logData);
    } else if (statusCode >= 400) {
      logger.warn(`${req.method} ${req.originalUrl} ${statusCode} - ${elapsedMs}ms`, logData);
    } else {
      logger.info(`${req.method} ${req.originalUrl} ${statusCode} - ${elapsedMs}ms`, logData);
    }
  });

  next();
}
