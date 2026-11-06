import { Redis } from 'ioredis';
import { env } from './env.config.js';
import { logger } from '../core/logging/logger.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 3000);
        logger.warn(`Redis connection retry attempt ${times} in ${delay}ms`);
        return delay;
      },
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready for commands');
    });

    redisClient.on('error', (err) => {
      logger.error('Redis client error:', err);
    });

    redisClient.on('close', () => {
      logger.warn('Redis client connection closed');
    });
  }

  return redisClient;
}

export async function checkRedisHealth(): Promise<{
  status: 'connected' | 'disconnected';
  latencyMs?: number;
}> {
  try {
    const client = getRedisClient();
    if (client.status === 'wait') {
      await client.connect();
    }
    const start = Date.now();
    const pingResponse = await client.ping();
    const latencyMs = Date.now() - start;

    if (pingResponse === 'PONG') {
      return { status: 'connected', latencyMs };
    }
    return { status: 'disconnected' };
  } catch (err) {
    logger.warn('Redis health check ping failed:', err);
    return { status: 'disconnected' };
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis client disconnected gracefully');
  }
}
