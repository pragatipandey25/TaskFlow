import http from 'http';
import { createApp } from './app.js';
import { env } from './config/env.config.js';
import { logger } from './core/logging/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis } from './config/redis.js';

async function bootstrap(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  // Initialize DB connections (asynchronous, non-blocking for basic liveness)
  try {
    await connectDatabase();
  } catch (err) {
    logger.warn('Continuing startup without immediate MongoDB connection (will retry)...');
  }

  server.listen(env.PORT, () => {
    logger.info(`🚀 TaskFlow Backend API server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
    logger.info(`👉 Health Check: http://localhost:${env.PORT}/api/health`);
    logger.info(`👉 Readiness Check: http://localhost:${env.PORT}/api/health/ready`);
  });

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);

    server.close(async () => {
      logger.info('HTTP server closed');
      try {
        await disconnectDatabase();
        await disconnectRedis();
        logger.info('Graceful shutdown completed successfully');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown cleanup:', err);
        process.exit(1);
      }
    });

    // Force shutdown if cleanup takes longer than 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown due to timeout (10s)');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Fatal bootstrap error:', err);
  process.exit(1);
});
