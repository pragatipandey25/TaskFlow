import crypto from 'crypto';
import {
  SocketEventName,
  SocketEventEnvelope,
  JobEventPayload,
  JobProgressPayload,
  QueueTelemetryPayload,
  WorkerTelemetryPayload,
} from '@taskflow/shared';
import { socketServer, SocketServer } from './socket.server.js';
import { getRedisClient } from '../../config/redis.js';
import { logger } from '../logging/logger.js';
import { sanitizePayload } from '../logging/log-sanitizer.js';

export class EventPublisher {
  private static instance: EventPublisher;
  private progressThrottleMap = new Map<string, number>();

  private static readonly PROGRESS_THROTTLE_MS = 250;

  private constructor() {}

  public static getInstance(): EventPublisher {
    if (!EventPublisher.instance) {
      EventPublisher.instance = new EventPublisher();
    }
    return EventPublisher.instance;
  }

  /**
   * Publishes an authoritative job lifecycle transition event.
   */
  public async publishJobEvent(
    eventType: SocketEventName,
    payload: JobEventPayload
  ): Promise<void> {
    const sanitizedData = sanitizePayload(payload) as JobEventPayload;

    const envelope: SocketEventEnvelope<JobEventPayload> = {
      eventId: crypto.randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: sanitizedData,
    };

    // Clean up progress throttle entry on terminal states
    if (
      eventType === SocketEventName.JOB_COMPLETED ||
      eventType === SocketEventName.JOB_FAILED ||
      eventType === SocketEventName.JOB_CANCELLED ||
      eventType === SocketEventName.JOB_DEAD_LETTERED
    ) {
      this.progressThrottleMap.delete(payload.jobId);
    }

    const rooms = [
      `user:${payload.userId}`,
      `room:user:${payload.userId}`,
      `job:${payload.jobId}`,
      `room:job:${payload.jobId}`,
      'admin:telemetry',
      'room:admin:telemetry',
    ];

    if (payload.queueName) {
      rooms.push(`queue:${payload.queueName}`);
      rooms.push(`room:queue:${payload.queueName}`);
    }

    await this.dispatch(rooms, eventType, envelope);
  }

  /**
   * Publishes a throttled job progress event.
   */
  public async publishProgress(payload: JobProgressPayload): Promise<void> {
    const now = Date.now();
    const lastEmitted = this.progressThrottleMap.get(payload.jobId) || 0;

    // Throttle progress events between 1% and 99% to prevent socket flooding
    const isBoundary = payload.progress <= 0 || payload.progress >= 100;
    if (!isBoundary && now - lastEmitted < EventPublisher.PROGRESS_THROTTLE_MS) {
      return;
    }

    this.progressThrottleMap.set(payload.jobId, now);

    const sanitizedMessage = payload.message ? sanitizePayload(payload.message) : undefined;
    const sanitizedData: JobProgressPayload = {
      ...payload,
      message: sanitizedMessage,
    };

    const envelope: SocketEventEnvelope<JobProgressPayload> = {
      eventId: crypto.randomUUID(),
      eventType: SocketEventName.JOB_PROGRESS,
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: sanitizedData,
    };

    const rooms = [
      `user:${payload.userId}`,
      `room:user:${payload.userId}`,
      `job:${payload.jobId}`,
      `room:job:${payload.jobId}`,
      'admin:telemetry',
      'room:admin:telemetry',
    ];

    await this.dispatch(rooms, SocketEventName.JOB_PROGRESS, envelope);
  }

  /**
   * Publishes real-time queue depth and processing statistics.
   */
  public async publishQueueTelemetry(payload: QueueTelemetryPayload): Promise<void> {
    const envelope: SocketEventEnvelope<QueueTelemetryPayload> = {
      eventId: crypto.randomUUID(),
      eventType: SocketEventName.QUEUE_STATS,
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: payload,
    };

    const rooms = [
      'admin:telemetry',
      'room:admin:telemetry',
      `queue:${payload.queueName}`,
      `room:queue:${payload.queueName}`,
    ];

    await this.dispatch(rooms, SocketEventName.QUEUE_STATS, envelope);
  }

  /**
   * Publishes worker heartbeat, registration, and status events.
   */
  public async publishWorkerTelemetry(
    eventType: SocketEventName,
    payload: WorkerTelemetryPayload
  ): Promise<void> {
    const envelope: SocketEventEnvelope<WorkerTelemetryPayload> = {
      eventId: crypto.randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: payload,
    };

    const rooms = ['admin:telemetry', 'room:admin:telemetry'];
    await this.dispatch(rooms, eventType, envelope);
  }

  /**
   * Core dispatch pipeline:
   * 1. Emits directly to local Socket.io if running in an API process.
   * 2. Publishes to Redis Pub/Sub for cross-process delivery (worker -> API nodes).
   */
  private async dispatch(
    rooms: string[],
    eventType: SocketEventName | string,
    envelope: SocketEventEnvelope<unknown>
  ): Promise<void> {
    // 1. In-process dispatch if Socket.io server is attached
    const io = socketServer.getIO();
    if (io) {
      try {
        io.to(rooms).emit(eventType, envelope);
      } catch (err) {
        logger.warn(`Failed local Socket.io emission for '${eventType}':`, err);
      }
    }

    // 2. Cross-process Redis broadcast
    try {
      const redis = getRedisClient();
      if (redis.status === 'ready' || redis.status === 'connect') {
        const message = JSON.stringify({
          rooms,
          eventType,
          envelope,
        });
        await redis.publish(SocketServer.REDIS_EVENT_CHANNEL, message);
      }
    } catch (err) {
      // Do not allow Redis socket broadcast failures to crash worker or API logic
      logger.warn(`Failed to publish event '${eventType}' to Redis stream:`, err);
    }
  }
}

export const eventPublisher = EventPublisher.getInstance();
