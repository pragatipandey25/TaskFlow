import { env } from './config/env.config.js';
import { logger } from './core/logging/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis } from './config/redis.js';

/**
 * TaskFlow Background Worker Process Entrypoint
 * This process executes independently of the Express HTTP server,
 * consuming jobs from BullMQ Redis queues.
 */
async function startWorker(): Promise<void> {
  logger.info(`Starting TaskFlow Worker Process [PID: ${process.pid}] in ${env.NODE_ENV} mode...`);

  try {
    await connectDatabase();
    logger.info('Worker process connected to MongoDB');
  } catch (err) {
    logger.error('Worker failed to connect to MongoDB:', err);
    process.exit(1);
  }

  logger.info(`Worker runtime initialized. Ready for queue worker registrations (Milestone 4).`);

  const shutdown = async (signal: string) => {
    logger.info(`Worker received ${signal}. Initiating graceful worker shutdown...`);
    try {
      await disconnectDatabase();
      await disconnectRedis();
      logger.info('Worker graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Error during worker shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startWorker().catch((err) => {
  logger.error('Fatal error in worker process:', err);
  process.exit(1);
});
