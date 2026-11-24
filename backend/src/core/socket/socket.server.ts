import http from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { Redis } from 'ioredis';
import { env } from '../../config/env.config.js';
import { logger } from '../logging/logger.js';
import { createRedisConnection, getRedisClient } from '../../config/redis.js';
import { TokenService } from '../../modules/auth/token.service.js';
import { UserModel } from '../../models/user.model.js';
import { JobModel } from '../../models/job.model.js';
import {
  UserRole,
  SocketEventName,
  SocketEventEnvelope,
  SystemConnectedPayload,
  SystemErrorPayload,
  SubscribeJobPayload,
  UnsubscribeJobPayload,
  SubscribeQueuePayload,
  UnsubscribeQueuePayload,
} from '@taskflow/shared';

export interface AuthenticatedSocketData {
  user: {
    id: string;
    email: string;
    role: UserRole;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppSocket = Socket<Record<string, any>, Record<string, any>, Record<string, any>, AuthenticatedSocketData>;

export class SocketServer {
  private static instance: SocketServer;
  private io: Server | null = null;
  private redisPubClient: Redis | null = null;
  private redisSubClient: Redis | null = null;
  private eventSubClient: Redis | null = null;
  private isShuttingDown = false;
  private isDistributed = false;
  private readonly instanceId = crypto.randomUUID();

  public static readonly REDIS_EVENT_CHANNEL = 'taskflow:events:stream';

  private constructor() {}

  public static getInstance(): SocketServer {
    if (!SocketServer.instance) {
      SocketServer.instance = new SocketServer();
    }
    return SocketServer.instance;
  }

  public getIO(): Server | null {
    return this.io;
  }

  public getInstanceId(): string {
    return this.instanceId;
  }

  public isDistributedAdapter(): boolean {
    return this.isDistributed;
  }

  /**
   * Forcibly disconnects all active sockets belonging to a specific user.
   */
  public disconnectUser(userId: string): void {
    if (!this.io) return;
    this.io.in(`user:${userId}`).disconnectSockets(true);
  }

  /**
   * Initializes Socket.io attached to the given Node.js HTTP server.
   */
  public async init(httpServer: http.Server): Promise<Server> {
    if (this.io) {
      return this.io;
    }

    this.isShuttingDown = false;

    this.io = new Server(httpServer, {
      cors: {
        origin: env.CORS_ORIGIN,
        credentials: true,
        methods: ['GET', 'POST'],
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 20000,
      pingInterval: 25000,
    });

    // Configure Redis Adapter for multi-instance clusters when Redis is operational
    await this.setupRedisAdapter();

    // Setup Cross-Process Redis Pub/Sub Event Subscriber (Workers -> API Socket.io)
    await this.setupCrossProcessEventSubscriber();

    // Handshake Authentication Middleware
    this.io.use(this.authenticateSocket.bind(this));

    // Connection & Room Management
    this.io.on('connection', this.handleConnection.bind(this));

    logger.info('Socket.io server initialized and attached to HTTP server');
    return this.io;
  }

  /**
   * Configures @socket.io/redis-adapter if Redis is reachable.
   * Gracefully degrades to in-memory adapter without failing startup.
   */
  private async setupRedisAdapter(): Promise<void> {
    if (!this.io) return;

    try {
      const redis = getRedisClient();
      if (redis.status === 'wait') {
        await Promise.race([
          redis.connect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 1500)),
        ]).catch(() => {});
      }

      if (redis.status === 'ready' || redis.status === 'connect') {
        this.redisPubClient = createRedisConnection();
        this.redisSubClient = createRedisConnection();

        await Promise.all([this.redisPubClient.connect(), this.redisSubClient.connect()]);

        // Wrap subClient unsubscription promises to prevent unhandled rejections during teardown
        const origPunsub = this.redisSubClient.punsubscribe.bind(this.redisSubClient);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.redisSubClient as any).punsubscribe = (...args: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = (origPunsub as any)(...args);
          if (p && typeof p.catch === 'function') p.catch(() => {});
          return p;
        };
        const origUnsub = this.redisSubClient.unsubscribe.bind(this.redisSubClient);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.redisSubClient as any).unsubscribe = (...args: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = (origUnsub as any)(...args);
          if (p && typeof p.catch === 'function') p.catch(() => {});
          return p;
        };

        this.io.adapter(createAdapter(this.redisPubClient, this.redisSubClient));
        this.isDistributed = true;
        logger.info('Socket.io Redis adapter successfully configured (Distributed Cluster Mode)');
      } else {
        this.isDistributed = false;
        logger.info('Redis is not in ready state; Socket.io running with in-memory adapter (Degraded Single-Node Mode).');
      }
    } catch (err) {
      this.isDistributed = false;
      logger.warn('Failed to initialize Socket.io Redis adapter. Operating in memory-only mode (Degraded Single-Node Mode):', err);
    }
  }

  /**
   * Subscribes to Redis Pub/Sub channel so events published by background workers
   * in external processes are dispatched to local WebSocket clients.
   */
  private async setupCrossProcessEventSubscriber(): Promise<void> {
    try {
      const redis = getRedisClient();
      if (redis.status === 'wait') {
        await Promise.race([
          redis.connect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 1500)),
        ]).catch(() => {});
      }

      if (redis.status === 'ready' || redis.status === 'connect') {
        this.eventSubClient = createRedisConnection();
        await this.eventSubClient.connect();

        await this.eventSubClient.subscribe(SocketServer.REDIS_EVENT_CHANNEL);

        this.eventSubClient.on('message', (_channel: string, message: string) => {
          if (!this.io || this.isShuttingDown) return;
          try {
            const parsed = JSON.parse(message);
            const { originId, rooms, eventType, envelope } = parsed;

            // Self-echo suppression: Ignore messages published by this instance
            if (originId && originId === this.instanceId) {
              return;
            }

            // Dispatch to local clients without re-broadcasting through Redis adapter
            if (rooms && Array.isArray(rooms) && rooms.length > 0) {
              this.io.local.to(rooms).emit(eventType, envelope);
            } else {
              this.io.local.emit(eventType, envelope);
            }
          } catch (parseErr) {
            logger.warn('Failed to parse cross-process Redis event message:', parseErr);
          }
        });

        logger.info(`Subscribed to cross-process Redis event channel: '${SocketServer.REDIS_EVENT_CHANNEL}'`);
      }
    } catch (err) {
      logger.warn('Cross-process event subscriber unavailable:', err);
    }
  }

  /**
   * Handshake authentication middleware verifying JWT access tokens.
   */
  private async authenticateSocket(socket: Socket, next: (err?: Error) => void): Promise<void> {
    try {
      // Extract token from handshake auth or headers
      let token = socket.handshake.auth?.token as string | undefined;

      if (!token && socket.handshake.headers?.authorization) {
        const header = socket.handshake.headers.authorization;
        if (header.startsWith('Bearer ')) {
          token = header.substring(7).trim();
        } else {
          token = header.trim();
        }
      }

      if (!token) {
        return next(new Error('Authentication error: Missing access token'));
      }

      // Verify token signature, algorithm, and expiration
      const decoded = TokenService.verifyAccessToken(token);

      // Verify user account status in database if connected
      if (mongoose.connection.readyState === 1) {
        const user = await UserModel.findById(decoded.userId).select('isActive email role');
        if (!user) {
          return next(new Error('Authentication error: User account not found'));
        }

        if (!user.isActive) {
          return next(new Error('Authentication error: User account is deactivated'));
        }

        socket.data = {
          user: {
            id: user._id.toString(),
            email: user.email,
            role: user.role,
          },
        };
      } else {
        socket.data = {
          user: {
            id: decoded.userId,
            email: decoded.email,
            role: decoded.role,
          },
        };
      }

      next();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid token';
      return next(new Error(`Authentication error: ${msg}`));
    }
  }

  /**
   * Handles authenticated client connection and sets up room subscriptions.
   */
  private handleConnection(socket: AppSocket): void {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    logger.info(`Socket connected [ID: ${socket.id}, User: ${user.email}, Role: ${user.role}]`);

    // 1. Join user-scoped private rooms automatically
    socket.join(`user:${user.id}`);
    socket.join(`room:user:${user.id}`);

    // 2. If ADMIN, automatically join admin telemetry room
    if (user.role === UserRole.ADMIN) {
      socket.join('admin:telemetry');
      socket.join('room:admin:telemetry');
    }

    // 3. Emit system connection confirmation
    const connectedPayload: SystemConnectedPayload = {
      socketId: socket.id,
      userId: user.id,
      role: user.role,
      serverTime: new Date().toISOString(),
    };

    const envelope: SocketEventEnvelope<SystemConnectedPayload> = {
      eventId: crypto.randomUUID(),
      eventType: SocketEventName.SYSTEM_CONNECTED,
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: connectedPayload,
    };

    socket.emit(SocketEventName.SYSTEM_CONNECTED, envelope);

    // 4. Handle client subscription requests
    socket.on('subscribe:job', async (payload: SubscribeJobPayload, callback?: (res: Record<string, unknown>) => void) => {
      await this.handleJobSubscription(socket, payload, callback);
    });

    socket.on('unsubscribe:job', (payload: UnsubscribeJobPayload, callback?: (res: Record<string, unknown>) => void) => {
      this.handleJobUnsubscription(socket, payload, callback);
    });

    socket.on('subscribe:queue', (payload: SubscribeQueuePayload, callback?: (res: Record<string, unknown>) => void) => {
      this.handleQueueSubscription(socket, payload, callback);
    });

    socket.on('unsubscribe:queue', (payload: UnsubscribeQueuePayload, callback?: (res: Record<string, unknown>) => void) => {
      this.handleQueueUnsubscription(socket, payload, callback);
    });

    socket.on('subscribe:admin:telemetry', (callback?: (res: Record<string, unknown>) => void) => {
      if (user.role === UserRole.ADMIN) {
        socket.join('admin:telemetry');
        socket.join('room:admin:telemetry');
        if (callback) callback({ success: true, message: 'Subscribed to admin telemetry' });
      } else {
        const errorEnvelope: SocketEventEnvelope<SystemErrorPayload> = {
          eventId: crypto.randomUUID(),
          eventType: SocketEventName.SYSTEM_ERROR,
          timestamp: new Date().toISOString(),
          version: '1.0',
          data: {
            code: 'FORBIDDEN',
            message: 'Administrative role required for system telemetry',
          },
        };
        socket.emit(SocketEventName.SYSTEM_ERROR, errorEnvelope);
        if (callback) callback({ success: false, error: 'Forbidden' });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected [ID: ${socket.id}, User: ${user.email}, Reason: ${reason}]`);
    });

    socket.on('error', (err) => {
      logger.error(`Socket error on [ID: ${socket.id}]:`, err);
    });
  }

  /**
   * Validates job ownership or role authorization before permitting room membership.
   */
  private async handleJobSubscription(
    socket: AppSocket,
    payload: SubscribeJobPayload,
    callback?: (res: Record<string, unknown>) => void
  ): Promise<void> {
    const user = socket.data.user;
    const jobId = payload?.jobId;

    if (!jobId || typeof jobId !== 'string') {
      if (callback) callback({ success: false, error: 'Invalid jobId parameter' });
      return;
    }

    try {
      // Admin has authorization to view all jobs
      if (user.role === UserRole.ADMIN) {
        socket.join(`job:${jobId}`);
        socket.join(`room:job:${jobId}`);
        if (callback) callback({ success: true, jobId });
        return;
      }

      // Non-admin: verify ownership in MongoDB
      let job = null;
      if (mongoose.Types.ObjectId.isValid(jobId)) {
        job = await JobModel.findById(jobId).select('userId jobId');
      }
      if (!job) {
        job = await JobModel.findOne({ jobId }).select('userId jobId');
      }

      // Prevent exposing existence of other users' jobs
      if (!job || job.userId.toString() !== user.id) {
        const errEnvelope: SocketEventEnvelope<SystemErrorPayload> = {
          eventId: crypto.randomUUID(),
          eventType: SocketEventName.SYSTEM_ERROR,
          timestamp: new Date().toISOString(),
          version: '1.0',
          data: {
            code: 'FORBIDDEN',
            message: 'Unauthorized access to job event room',
          },
        };
        socket.emit(SocketEventName.SYSTEM_ERROR, errEnvelope);
        if (callback) callback({ success: false, error: 'Unauthorized' });
        return;
      }

      socket.join(`job:${job.jobId}`);
      socket.join(`room:job:${job.jobId}`);
      if (callback) callback({ success: true, jobId: job.jobId });
    } catch (err) {
      logger.warn(`Error subscribing socket to job '${jobId}':`, err);
      if (callback) callback({ success: false, error: 'Subscription failed' });
    }
  }

  private handleJobUnsubscription(
    socket: AppSocket,
    payload: UnsubscribeJobPayload,
    callback?: (res: Record<string, unknown>) => void
  ): void {
    const jobId = payload?.jobId;
    if (jobId) {
      socket.leave(`job:${jobId}`);
      socket.leave(`room:job:${jobId}`);
      if (callback) callback({ success: true, jobId });
    }
  }

  private handleQueueSubscription(
    socket: AppSocket,
    payload: SubscribeQueuePayload,
    callback?: (res: Record<string, unknown>) => void
  ): void {
    const queueName = payload?.queueName;

    if (!queueName || typeof queueName !== 'string') {
      if (callback) callback({ success: false, error: 'Invalid queueName' });
      return;
    }

    // Role check: viewers, developers, admins can monitor queue metrics
    socket.join(`queue:${queueName}`);
    socket.join(`room:queue:${queueName}`);
    if (callback) callback({ success: true, queueName });
  }

  private handleQueueUnsubscription(
    socket: AppSocket,
    payload: UnsubscribeQueuePayload,
    callback?: (res: Record<string, unknown>) => void
  ): void {
    const queueName = payload?.queueName;
    if (queueName) {
      socket.leave(`queue:${queueName}`);
      socket.leave(`room:queue:${queueName}`);
      if (callback) callback({ success: true, queueName });
    }
  }

  /**
   * Graceful shutdown of Socket.io, closing adapters and subscriber clients.
   */
  public async close(): Promise<void> {
    this.isShuttingDown = true;
    this.isDistributed = false;

    // 1. Close Socket.io server first so that adapters can cleanly unhook while Redis is open
    if (this.io) {
      await new Promise<void>((resolve) => {
        this.io!.close(() => {
          logger.info('Socket.io server closed');
          resolve();
        });
      });
      this.io = null;
      // Allow in-flight adapter unsubscribe messages to flush
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // 2. Disconnect cross-process event subscriber
    if (this.eventSubClient) {
      this.eventSubClient.disconnect();
      this.eventSubClient = null;
    }

    // 3. Disconnect Redis adapter pub/sub clients
    if (this.redisPubClient) {
      this.redisPubClient.disconnect();
      this.redisPubClient = null;
    }
    if (this.redisSubClient) {
      this.redisSubClient.disconnect();
      this.redisSubClient = null;
    }
  }
}

export const socketServer = SocketServer.getInstance();
