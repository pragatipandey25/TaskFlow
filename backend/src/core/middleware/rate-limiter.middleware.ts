import rateLimit, { Store, Options, ClientRateLimitInfo } from 'express-rate-limit';
import { env } from '../../config/env.config.js';
import { getRedisClient } from '../../config/redis.js';
import { logger } from '../logging/logger.js';

/**
 * Resilient Redis Store for express-rate-limit with automatic fallback
 * to in-memory map during Redis downtime.
 */
class ResilientRedisStore implements Store {
  public windowMs: number = 15 * 60 * 1000;
  private inMemoryFallback = new Map<string, { count: number; resetTime: number }>();
  public prefix: string;

  constructor(prefix: string = 'rl:auth:') {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const redisKey = `${this.prefix}${key}`;
    try {
      const redis = getRedisClient();
      if (redis.status === 'ready' || redis.status === 'connect') {
        const pipeline = redis.pipeline();
        pipeline.incr(redisKey);
        pipeline.pttl(redisKey);
        const results = await pipeline.exec();

        if (results && results[0] && results[1]) {
          const count = results[0][1] as number;
          let pttl = results[1][1] as number;

          // If key was just created without a TTL, assign window TTL
          if (pttl === -1 || pttl === -2) {
            await redis.pexpire(redisKey, this.windowMs);
            pttl = this.windowMs;
          }

          return {
            totalHits: count,
            resetTime: new Date(Date.now() + Math.max(0, pttl)),
          };
        }
      }
    } catch (err) {
      logger.warn(
        `Rate limiter failed to communicate with Redis. Gracefully falling back to in-memory store:`,
        err
      );
    }

    // In-Memory Fallback
    const now = Date.now();
    const entry = this.inMemoryFallback.get(key);
    if (!entry || entry.resetTime <= now) {
      const resetTime = now + this.windowMs;
      this.inMemoryFallback.set(key, { count: 1, resetTime });
      return { totalHits: 1, resetTime: new Date(resetTime) };
    }

    entry.count += 1;
    return {
      totalHits: entry.count,
      resetTime: new Date(entry.resetTime),
    };
  }

  async decrement(key: string): Promise<void> {
    const redisKey = `${this.prefix}${key}`;
    try {
      const redis = getRedisClient();
      if (redis.status === 'ready' || redis.status === 'connect') {
        await redis.decr(redisKey);
        return;
      }
    } catch (err) {
      logger.warn('Rate limiter Redis decrement failed:', err);
    }

    const entry = this.inMemoryFallback.get(key);
    if (entry && entry.count > 0) {
      entry.count -= 1;
    }
  }

  async resetKey(key: string): Promise<void> {
    const redisKey = `${this.prefix}${key}`;
    try {
      const redis = getRedisClient();
      if (redis.status === 'ready' || redis.status === 'connect') {
        await redis.del(redisKey);
      }
    } catch (err) {
      logger.warn('Rate limiter Redis resetKey failed:', err);
    }
    this.inMemoryFallback.delete(key);
  }
}

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15-minute window
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  store: new ResilientRedisStore('rl:auth:'),
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts. Please try again after 15 minutes.',
      timestamp: new Date().toISOString(),
    },
  },
  skip: () => env.NODE_ENV === 'test', // Safely skip in automated test suites
});
