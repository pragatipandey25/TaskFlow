import { getDatabaseStatus } from '../../config/database.js';
import { checkRedisHealth } from '../../config/redis.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  timestamp: string;
  environment: string;
  version: string;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
}

export interface ReadinessCheckResult extends HealthCheckResult {
  dependencies: {
    mongodb: {
      status: 'connected' | 'disconnected' | 'connecting' | 'disconnecting';
      readyState: number;
    };
    redis: {
      status: 'connected' | 'disconnected';
      latencyMs?: number;
    };
  };
}

export class HealthService {
  public static getBasicHealth(): HealthCheckResult {
    const memory = process.memoryUsage();
    return {
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      memory: {
        rssMb: Math.round((memory.rss / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((memory.heapTotal / 1024 / 1024) * 100) / 100,
      },
    };
  }

  public static async getReadiness(): Promise<ReadinessCheckResult> {
    const basic = this.getBasicHealth();
    const dbStatus = getDatabaseStatus();
    const redisStatus = await checkRedisHealth();

    const isMongoOk = dbStatus.status === 'connected';
    const isRedisOk = redisStatus.status === 'connected';

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!isMongoOk && !isRedisOk) {
      overallStatus = 'unhealthy';
    } else if (!isMongoOk || !isRedisOk) {
      overallStatus = 'degraded';
    }

    return {
      ...basic,
      status: overallStatus,
      dependencies: {
        mongodb: dbStatus,
        redis: redisStatus,
      },
    };
  }
}
