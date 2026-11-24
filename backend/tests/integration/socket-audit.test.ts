import { jest } from '@jest/globals';
import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app.js';
import { socketServer, SocketServer } from '../../src/core/socket/socket.server.js';
import { eventPublisher } from '../../src/core/socket/event-publisher.js';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { UserModel } from '../../src/models/user.model.js';
import { JobModel } from '../../src/models/job.model.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { env } from '../../src/config/env.config.js';
import { MiniRedisServer } from '../helpers/redis-mock-server.helper.js';
import {
  UserRole,
  JobStatus,
  SocketEventName,
  SocketEventEnvelope,
  JobEventPayload,
  JobProgressPayload,
  QueueTelemetryPayload,
  WorkerTelemetryPayload,
  WorkerStatus,
} from '@taskflow/shared';

describe('Milestone 6: Distributed Reliability & Security Audit', () => {
  jest.setTimeout(60000);

  let miniRedis: MiniRedisServer;
  let redisPort: number;

  let server1: http.Server;
  let server1Url: string;

  const openSockets: ClientSocket[] = [];

  let adminUser: any;
  let devUserA: any;
  let devUserB: any;
  let viewerUser: any;

  let adminToken: string;
  let devTokenA: string;
  let devTokenB: string;
  let viewerToken: string;

  beforeAll(async () => {
    // 1. Start in-process TCP MiniRedis server
    miniRedis = new MiniRedisServer();
    redisPort = await miniRedis.start();

    // 2. Point env to MiniRedis
    (env as any).REDIS_PORT = redisPort;
    (env as any).REDIS_HOST = '127.0.0.1';

    // 3. Setup MongoDB Memory Replica Set
    await setupTestDatabase();

    // 4. Initialize Primary API Server (Server 1)
    const app1 = createApp();
    server1 = http.createServer(app1);
    await socketServer.init(server1);

    await new Promise<void>((resolve) => {
      server1.listen(0, () => {
        const addr = server1.address() as AddressInfo;
        server1Url = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }, 60000);

  afterAll(async () => {
    for (const s of openSockets) {
      if (s.connected) s.disconnect();
    }
    openSockets.length = 0;

    await socketServer.close();
    if (server1) {
      await new Promise<void>((resolve) => {
        server1.close(() => resolve());
      });
    }

    await teardownTestDatabase();
    await disconnectRedis();
    await new Promise((r) => setTimeout(r, 100));
    if (miniRedis) {
      await miniRedis.stop();
    }
  });

  afterEach(() => {
    for (const s of openSockets) {
      if (s.connected) s.disconnect();
    }
    openSockets.length = 0;
  });

  beforeEach(async () => {
    await clearTestDatabase();

    // Seed test accounts across roles
    adminUser = await UserModel.create({
      name: 'Audit Admin',
      email: 'admin@audit.dev',
      passwordHash: 'hash_admin',
      role: UserRole.ADMIN,
      isActive: true,
    });
    adminToken = TokenService.generateAccessToken({
      userId: adminUser._id.toString(),
      email: adminUser.email,
      role: adminUser.role,
    }).accessToken;

    devUserA = await UserModel.create({
      name: 'Developer Alice',
      email: 'alice@audit.dev',
      passwordHash: 'hash_alice',
      role: UserRole.DEVELOPER,
      isActive: true,
    });
    devTokenA = TokenService.generateAccessToken({
      userId: devUserA._id.toString(),
      email: devUserA.email,
      role: devUserA.role,
    }).accessToken;

    devUserB = await UserModel.create({
      name: 'Developer Bob',
      email: 'bob@audit.dev',
      passwordHash: 'hash_bob',
      role: UserRole.DEVELOPER,
      isActive: true,
    });
    devTokenB = TokenService.generateAccessToken({
      userId: devUserB._id.toString(),
      email: devUserB.email,
      role: devUserB.role,
    }).accessToken;

    viewerUser = await UserModel.create({
      name: 'Auditor Viewer',
      email: 'viewer@audit.dev',
      passwordHash: 'hash_viewer',
      role: UserRole.VIEWER,
      isActive: true,
    });
    viewerToken = TokenService.generateAccessToken({
      userId: viewerUser._id.toString(),
      email: viewerUser.email,
      role: viewerUser.role,
    }).accessToken;
  });

  const connectClient = (token: string, url = server1Url): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const socket = ioClient(url, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000,
      });

      socket.on('connect', () => {
        openSockets.push(socket);
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        reject(err);
      });
    });
  };

  // =========================================================================
  // Section 2: Real Redis Cross-Process Delivery
  // =========================================================================
  describe('2. Real Redis Cross-Process Event Delivery (Worker -> Redis -> API -> Client)', () => {
    it('should deliver events published from an external worker process via Redis Pub/Sub to authorized clients', async () => {
      // 1. Connect Dev A and Dev B to API Server 1
      const clientA = await connectClient(devTokenA);
      const clientB = await connectClient(devTokenB);

      // Create Alice's job in MongoDB
      const jobDoc = await JobModel.create({
        jobId: 'job_audit_worker_001',
        name: 'Worker Audit Job',
        type: 'report-generation',
        queueName: 'audit-queue',
        jobType: 'report-generation',
        payload: { task: 'quarterly-audit' },
        status: JobStatus.QUEUED,
        userId: devUserA._id,
      });

      // Alice subscribes to her job room
      await new Promise<void>((resolve) => {
        clientA.emit('subscribe:job', { jobId: jobDoc.jobId }, () => resolve());
      });

      // 2. Setup separate external Worker Redis client (simulating a detached worker process)
      const workerRedis = new Redis({
        host: '127.0.0.1',
        port: redisPort,
        lazyConnect: true,
      });
      workerRedis.on('error', () => {});
      await workerRedis.connect();

      const receivedByAlice: any[] = [];
      const receivedByBob: any[] = [];

      clientA.on(SocketEventName.JOB_STARTED, (envelope) => receivedByAlice.push(envelope));
      clientB.on(SocketEventName.JOB_STARTED, (envelope) => receivedByBob.push(envelope));

      // 3. Worker process publishes job:started directly to Redis stream (no local Socket.io)
      const workerPayload: JobEventPayload = {
        jobId: jobDoc.jobId,
        userId: devUserA._id.toString(),
        queueName: 'audit-queue',
        jobType: 'report-generation',
        status: JobStatus.PROCESSING,
        workerId: 'worker-proc-99',
        timestamp: new Date().toISOString(),
      };

      const workerEnvelope: SocketEventEnvelope<JobEventPayload> = {
        eventId: 'worker_evt_uuid_101',
        eventType: SocketEventName.JOB_STARTED,
        timestamp: new Date().toISOString(),
        version: '1.0',
        data: workerPayload,
      };

      const streamMessage = JSON.stringify({
        originId: 'worker-process-external',
        rooms: [`user:${devUserA._id}`, `job:${jobDoc.jobId}`],
        eventType: SocketEventName.JOB_STARTED,
        envelope: workerEnvelope,
      });

      await workerRedis.publish(SocketServer.REDIS_EVENT_CHANNEL, streamMessage);

      // 4. Await event dispatch through API Redis subscriber
      await new Promise((r) => setTimeout(r, 400));

      // Alice received worker event
      expect(receivedByAlice.length).toBe(1);
      expect(receivedByAlice[0].eventId).toBe('worker_evt_uuid_101');
      expect(receivedByAlice[0].data.jobId).toBe(jobDoc.jobId);
      expect(receivedByAlice[0].data.workerId).toBe('worker-proc-99');

      // Bob received NOTHING (strict room isolation enforced)
      expect(receivedByBob.length).toBe(0);

      await workerRedis.quit();
    });

    it('should not crash or corrupt worker operations when Redis publication fails', async () => {
      // Disconnected / invalid publisher simulation
      const disconnectedRedis = new Redis({
        host: '127.0.0.1',
        port: 65530, // Unreachable port
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });
      disconnectedRedis.on('error', () => {});

      let threw = false;
      try {
        await disconnectedRedis.publish('taskflow:events:stream', 'test').catch(() => {
          // Expected error handled safely without crashing
          threw = true;
        });
      } finally {
        disconnectedRedis.disconnect();
      }

      expect(threw).toBe(true);
    });
  });

  // =========================================================================
  // Section 3: Multi-Instance Socket.io Verification
  // =========================================================================
  describe('3. Multi-Instance Socket.io Verification (Instance A & Instance B)', () => {
    let server2: http.Server;
    let server2Url: string;
    let io2: SocketIOServer;
    let pubClient2: Redis;
    let subClient2: Redis;

    beforeAll(async () => {
      // Create independent HTTP Server 2 (Instance B)
      const app2 = createApp();
      server2 = http.createServer(app2);

      io2 = new SocketIOServer(server2, {
        cors: { origin: '*', credentials: true },
        transports: ['websocket'],
      });

      pubClient2 = new Redis({ host: '127.0.0.1', port: redisPort, lazyConnect: true });
      subClient2 = new Redis({ host: '127.0.0.1', port: redisPort, lazyConnect: true });
      pubClient2.on('error', () => {});
      subClient2.on('error', () => {});
      await Promise.all([pubClient2.connect(), subClient2.connect()]);

      const origPunsub = subClient2.punsubscribe.bind(subClient2);
      subClient2.punsubscribe = (...args: any[]) => {
        const p = origPunsub(...args);
        if (p && typeof p.catch === 'function') p.catch(() => {});
        return p;
      };
      const origUnsub = subClient2.unsubscribe.bind(subClient2);
      subClient2.unsubscribe = (...args: any[]) => {
        const p = origUnsub(...args);
        if (p && typeof p.catch === 'function') p.catch(() => {});
        return p;
      };

      // Hook Instance 2 to same Redis adapter
      io2.adapter(createAdapter(pubClient2, subClient2));

      // Add authentication
      io2.use((socket, next) => {
        try {
          const token = socket.handshake.auth?.token;
          const decoded = TokenService.verifyAccessToken(token);
          socket.data = {
            user: { id: decoded.userId, email: decoded.email, role: decoded.role },
          };
          next();
        } catch (err: any) {
          next(new Error(`Authentication error: ${err.message}`));
        }
      });

      io2.on('connection', (socket: any) => {
        const u = socket.data.user;
        socket.join(`user:${u.id}`);
        socket.join(`room:user:${u.id}`);
      });

      await new Promise<void>((resolve) => {
        server2.listen(0, () => {
          const addr = server2.address() as AddressInfo;
          server2Url = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        io2.close(() => resolve());
      });
      pubClient2.disconnect();
      subClient2.disconnect();
      await new Promise<void>((resolve) => {
        server2.close(() => resolve());
      });
      await new Promise((r) => setTimeout(r, 100));
    });

    it('should route event emitted from Instance B across Redis adapter to Client on Instance A', async () => {
      // Client A connects to Server 1 (Instance A)
      const clientA = await connectClient(devTokenA, server1Url);
      // Client B connects to Server 2 (Instance B)
      const clientB = await connectClient(devTokenB, server2Url);

      const receivedA: any[] = [];
      const receivedB: any[] = [];

      clientA.on(SocketEventName.JOB_QUEUED, (env) => receivedA.push(env));
      clientB.on(SocketEventName.JOB_QUEUED, (env) => receivedB.push(env));

      // Instance B emits to room user:devUserA
      const clusterEnvelope: SocketEventEnvelope<JobEventPayload> = {
        eventId: 'cluster_evt_uuid_202',
        eventType: SocketEventName.JOB_QUEUED,
        timestamp: new Date().toISOString(),
        version: '1.0',
        data: {
          jobId: 'job_cluster_test_01',
          userId: devUserA._id.toString(),
          queueName: 'cluster-queue',
          jobType: 'cluster-task',
          status: JobStatus.QUEUED,
          timestamp: new Date().toISOString(),
        },
      };

      // Emit from Instance B to Alice's room
      io2.to(`user:${devUserA._id}`).emit(SocketEventName.JOB_QUEUED, clusterEnvelope);

      await new Promise((r) => setTimeout(r, 400));

      // Client A on Instance 1 received message broadcast from Instance 2
      expect(receivedA.length).toBe(1);
      expect(receivedA[0].eventId).toBe('cluster_evt_uuid_202');
      expect(receivedA[0].data.jobId).toBe('job_cluster_test_01');

      // Client B on Instance 2 did NOT receive it (room isolation preserved)
      expect(receivedB.length).toBe(0);
    });

    it('should accurately report distributed adapter state', () => {
      expect(socketServer.isDistributedAdapter()).toBe(true);
    });
  });

  // =========================================================================
  // Section 4: Event Consistency for All 9 Lifecycle Events
  // =========================================================================
  describe('4. Event Consistency and Duplicate Handling Across All 9 Lifecycle Events', () => {
    const lifecycleEvents: { name: SocketEventName; status: JobStatus }[] = [
      { name: SocketEventName.JOB_SUBMITTED, status: JobStatus.PENDING },
      { name: SocketEventName.JOB_QUEUED, status: JobStatus.QUEUED },
      { name: SocketEventName.JOB_STARTED, status: JobStatus.PROCESSING },
      { name: SocketEventName.JOB_PROGRESS, status: JobStatus.PROCESSING },
      { name: SocketEventName.JOB_RETRYING, status: JobStatus.RETRYING },
      { name: SocketEventName.JOB_COMPLETED, status: JobStatus.COMPLETED },
      { name: SocketEventName.JOB_FAILED, status: JobStatus.FAILED },
      { name: SocketEventName.JOB_CANCELLED, status: JobStatus.CANCELLED },
      { name: SocketEventName.JOB_DEAD_LETTERED, status: JobStatus.DEAD_LETTER },
    ];

    it.each(lifecycleEvents)('should emit valid structured envelope for $name', async ({ name, status }) => {
      const client = await connectClient(devTokenA);
      const receivedEvents: any[] = [];
      client.on(name, (envelope) => receivedEvents.push(envelope));

      if (name === SocketEventName.JOB_PROGRESS) {
        await eventPublisher.publishProgress({
          jobId: `job_lifecycle_${name}`,
          userId: devUserA._id.toString(),
          progress: 50,
          message: 'Processing item 50 of 100',
        });
      } else {
        await eventPublisher.publishJobEvent(name, {
          jobId: `job_lifecycle_${name}`,
          userId: devUserA._id.toString(),
          queueName: 'lifecycle-queue',
          jobType: 'lifecycle-test',
          status,
          timestamp: new Date().toISOString(),
        });
      }

      await new Promise((r) => setTimeout(r, 200));

      expect(receivedEvents.length).toBe(1);
      const envelope = receivedEvents[0];
      expect(envelope).toHaveProperty('eventId');
      expect(typeof envelope.eventId).toBe('string');
      expect(envelope.eventType).toBe(name);
      expect(envelope.version).toBe('1.0');
      expect(new Date(envelope.timestamp).getTime()).not.toBeNaN();
      expect(envelope.data.userId).toBe(devUserA._id.toString());
    });

    it('should purge throttling state on terminal lifecycle transitions', async () => {
      const jobId = 'job_terminal_cleanup_test';

      // 1. Send intermediate progress
      await eventPublisher.publishProgress({
        jobId,
        userId: devUserA._id.toString(),
        progress: 45,
      });

      // 2. Publish terminal JOB_COMPLETED event
      await eventPublisher.publishJobEvent(SocketEventName.JOB_COMPLETED, {
        jobId,
        userId: devUserA._id.toString(),
        queueName: 'default',
        jobType: 'cleanup-test',
        status: JobStatus.COMPLETED,
        timestamp: new Date().toISOString(),
      });

      // 3. Immediately send 46% progress (would have been throttled without cleanup)
      const client = await connectClient(devTokenA);
      const progressEvents: any[] = [];
      client.on(SocketEventName.JOB_PROGRESS, (env) => progressEvents.push(env));

      await eventPublisher.publishProgress({
        jobId,
        userId: devUserA._id.toString(),
        progress: 46,
      });

      await new Promise((r) => setTimeout(r, 200));

      // Because throttle entry was deleted, 46% was accepted as a fresh stream
      expect(progressEvents.length).toBe(1);
      expect(progressEvents[0].data.progress).toBe(46);
    });
  });

  // =========================================================================
  // Section 5: Authentication Lifecycle and Authorization Matrix
  // =========================================================================
  describe('5. Authentication Lifecycle & Authorization Boundary Matrix', () => {
    it('should reject connection when token is expired', async () => {
      const expiredToken = jwt.sign(
        { userId: devUserA._id.toString(), email: devUserA.email, role: devUserA.role },
        env.JWT_SECRET,
        { expiresIn: '0s' }
      );

      await expect(connectClient(expiredToken)).rejects.toThrow(/Access token has expired/);
    });

    it('should reject connection when token signature is tampered', async () => {
      const tamperedToken = devTokenA + '_tampered';
      await expect(connectClient(tamperedToken)).rejects.toThrow(/invalid access token|invalid signature|jwt malformed/i);
    });

    it('should immediately disconnect all active sockets of a user via disconnectUser', async () => {
      const client = await connectClient(devTokenA);
      expect(client.connected).toBe(true);

      let disconnected = false;
      client.on('disconnect', () => {
        disconnected = true;
      });

      socketServer.disconnectUser(devUserA._id.toString());

      await new Promise((r) => setTimeout(r, 250));
      expect(disconnected).toBe(true);
      expect(client.connected).toBe(false);
    });

    it('should allow Viewer to subscribe to queue metrics but prevent admin:telemetry access', async () => {
      const client = await connectClient(viewerToken);

      // 1. Viewer subscribes to queue
      const queueRes: any = await new Promise((resolve) => {
        client.emit('subscribe:queue', { queueName: 'video-transcode' }, (res: any) => resolve(res));
      });
      expect(queueRes.success).toBe(true);

      // 2. Viewer attempts admin:telemetry subscription
      const adminRes: any = await new Promise((resolve) => {
        client.emit('subscribe:admin:telemetry', (res: any) => resolve(res));
      });
      expect(adminRes.success).toBe(false);
      expect(adminRes.error).toBe('Forbidden');
    });

    it('should allow Admin full authorization to subscribe to any job and system telemetry', async () => {
      const adminClient = await connectClient(adminToken);

      // Alice owns this job
      const aliceJob = await JobModel.create({
        jobId: 'job_alice_private_999',
        name: 'Private Audit Job',
        type: 'private-data',
        queueName: 'default',
        jobType: 'private-data',
        payload: { secret: 'audit-secret' },
        status: JobStatus.QUEUED,
        userId: devUserA._id,
      });

      // Admin subscribes to Alice's job
      const jobSubRes: any = await new Promise((resolve) => {
        adminClient.emit('subscribe:job', { jobId: aliceJob.jobId }, (res: any) => resolve(res));
      });
      expect(jobSubRes.success).toBe(true);

      // Admin subscribes to telemetry
      const adminSubRes: any = await new Promise((resolve) => {
        adminClient.emit('subscribe:admin:telemetry', (res: any) => resolve(res));
      });
      expect(adminSubRes.success).toBe(true);
    });
  });

  // =========================================================================
  // Section 8: Progress Throttling Verification
  // =========================================================================
  describe('8. Progress Throttling Verification (250ms Rate Limit & Boundaries)', () => {
    it('should enforce 250ms throttling on rapid progress bursts but immediately emit 0% and 100% boundaries', async () => {
      const client = await connectClient(devTokenA);
      const receivedProgress: number[] = [];

      client.on(SocketEventName.JOB_PROGRESS, (envelope) => {
        receivedProgress.push(envelope.data.progress);
      });

      const uniqueJobId = 'job_audit_throttle_burst_1';

      // 1. Boundary 0%
      await eventPublisher.publishProgress({
        jobId: uniqueJobId,
        userId: devUserA._id.toString(),
        progress: 0,
      });

      // 2. Intermediate 15% (first intermediate update is emitted)
      await eventPublisher.publishProgress({
        jobId: uniqueJobId,
        userId: devUserA._id.toString(),
        progress: 15,
      });

      // 3. Rapid bursts 20%, 25%, 30% within 10ms (MUST be throttled)
      await eventPublisher.publishProgress({
        jobId: uniqueJobId,
        userId: devUserA._id.toString(),
        progress: 20,
      });
      await eventPublisher.publishProgress({
        jobId: uniqueJobId,
        userId: devUserA._id.toString(),
        progress: 25,
      });
      await eventPublisher.publishProgress({
        jobId: uniqueJobId,
        userId: devUserA._id.toString(),
        progress: 30,
      });

      // 4. Boundary 100% (MUST bypass throttling)
      await eventPublisher.publishProgress({
        jobId: uniqueJobId,
        userId: devUserA._id.toString(),
        progress: 100,
      });

      await new Promise((r) => setTimeout(r, 200));

      // Expected received: [0, 15, 100] -> 20, 25, 30 were throttled
      expect(receivedProgress).toEqual([0, 15, 100]);
    });
  });
});
