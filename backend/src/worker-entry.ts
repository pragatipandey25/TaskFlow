import { env } from './config/env.config.js';
import { logger } from './core/logging/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis } from './config/redis.js';
import { registerDefaultProcessors } from './core/worker/register-processors.js';
import { workerManager } from './core/worker/worker-manager.js';
import { jobReconciliationService } from './core/queue/reconciliation.service.js';

/**
 * TaskFlow Background Worker Process Entrypoint
 * This process executes independently of the Express HTTP server,
 * consuming jobs from BullMQ Redis queues with concurrent processing.
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

  // Register built-in demonstration job handlers
  registerDefaultProcessors();

  // Initialize and start the BullMQ worker instance
  workerManager.startWorker(env.DEFAULT_QUEUE_NAME);
  logger.info(
    `Worker runtime initialized [WorkerID: ${workerManager.getWorkerId()}]. Listening on queue '${env.DEFAULT_QUEUE_NAME}' with concurrency ${env.WORKER_CONCURRENCY}.`
  );

  // Start periodic dual-write reconciliation sweeper
  jobReconciliationService.startPeriodicReconciliation(30000);

  const shutdown = async (signal: string) => {
    logger.info(`Worker received ${signal}. Initiating graceful worker shutdown sequence...`);
    try {
      jobReconciliationService.stopPeriodicReconciliation();
      await workerManager.shutdown();
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
