import { jest } from '@jest/globals';
import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { socketServer } from '../../src/core/socket/socket.server.js';
import { eventPublisher } from '../../src/core/socket/event-publisher.js';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { UserModel } from '../../src/models/user.model.js';
import { JobModel } from '../../src/models/job.model.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env.config.js';
import {
  UserRole,
  JobStatus,
  SocketEventName,
  SocketEventEnvelope,
  SystemConnectedPayload,
  SystemErrorPayload,
  JobEventPayload,
  JobProgressPayload,
  QueueTelemetryPayload,
  WorkerTelemetryPayload,
  WorkerStatus,
} from '@taskflow/shared';

describe('Milestone 6: Socket.io Real-Time Telemetry & Event Streaming (Integration)', () => {
  jest.setTimeout(60000);

  let server: http.Server;
  let serverUrl: string;
  const openSockets: ClientSocket[] = [];

  let adminUser: any;
  let devUserA: any;
  let devUserB: any;
  let inactiveDevUser: any;

  let adminToken: string;
  let devTokenA: string;
  let devTokenB: string;
  let inactiveDevToken: string;

  beforeAll(async () => {
    await setupTestDatabase();

    const app = createApp();
    server = http.createServer(app);
    await socketServer.init(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${address.port}`;
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    await teardownTestDatabase();
    await disconnectRedis();
  });

  beforeEach(async () => {
    await clearTestDatabase();

    // 1. Seed Admin User
    adminUser = await UserModel.create({
      name: 'System Admin',
      email: 'admin@taskflow.dev',
      passwordHash: 'hash_admin',
      role: UserRole.ADMIN,
      isActive: true,
    });
    adminToken = TokenService.generateAccessToken({
      userId: adminUser._id.toString(),
      email: adminUser.email,
      role: adminUser.role,
    }).accessToken;

    // 2. Seed Developer A
    devUserA = await UserModel.create({
      name: 'Dev Alice',
      email: 'alice@taskflow.dev',
      passwordHash: 'hash_alice',
      role: UserRole.DEVELOPER,
      isActive: true,
    });
    devTokenA = TokenService.generateAccessToken({
      userId: devUserA._id.toString(),
      email: devUserA.email,
      role: devUserA.role,
    }).accessToken;

    // 3. Seed Developer B
    devUserB = await UserModel.create({
      name: 'Dev Bob',
      email: 'bob@taskflow.dev',
      passwordHash: 'hash_bob',
      role: UserRole.DEVELOPER,
      isActive: true,
    });
    devTokenB = TokenService.generateAccessToken({
      userId: devUserB._id.toString(),
      email: devUserB.email,
      role: devUserB.role,
    }).accessToken;

    // 4. Seed Deactivated User
    inactiveDevUser = await UserModel.create({
      name: 'Deactivated Dan',
      email: 'dan@taskflow.dev',
      passwordHash: 'hash_dan',
      role: UserRole.DEVELOPER,
      isActive: false,
    });
    inactiveDevToken = TokenService.generateAccessToken({
      userId: inactiveDevUser._id.toString(),
      email: inactiveDevUser.email,
      role: inactiveDevUser.role,
    }).accessToken;
  });

  afterEach(() => {
    while (openSockets.length > 0) {
      const s = openSockets.pop();
      if (s && s.connected) {
        s.disconnect();
      }
    }
  });

  function createClient(token?: string, extraHeaders?: Record<string, string>): ClientSocket {
    const client = ioClient(serverUrl, {
      auth: token ? { token } : undefined,
      extraHeaders,
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
      forceNew: true,
    });
    openSockets.push(client);
    return client;
  }

  function waitForEvent<T = any>(socket: ClientSocket, event: string, timeoutMs = 8000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for socket event '${event}' after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.once(event, (data: T) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  function waitForConnectError(socket: ClientSocket, timeoutMs = 8000): Promise<Error> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for socket connect_error after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.once('connect_error', (err: Error) => {
        clearTimeout(timer);
        resolve(err);
      });
    });
  }

  // =========================================================================
  // 1. Handshake Authentication & Access Verification
  // =========================================================================
  describe('1. Handshake Authentication & Security', () => {
    it('should reject unauthenticated connection without access token', async () => {
      const client = createClient();
      const err = await waitForConnectError(client);
      expect(err.message).toMatch(/Authentication error: Missing access token/i);
      expect(client.connected).toBe(false);
    });

    it('should reject connection with malformed or invalid JWT token signature', async () => {
      const client = createClient('malformed.jwt.token_string');
      const err = await waitForConnectError(client);
      expect(err.message).toMatch(/Authentication error:/i);
      expect(client.connected).toBe(false);
    });

    it('should reject connection with expired access token', async () => {
      const expiredToken = jwt.sign(
        { userId: devUserA._id.toString(), email: devUserA.email, role: devUserA.role },
        env.JWT_SECRET,
        { expiresIn: 0, algorithm: 'HS256' }
      );

      const client = createClient(expiredToken);
      const err = await waitForConnectError(client);
      expect(err.message).toMatch(/Authentication error: Access token has expired/i);
      expect(client.connected).toBe(false);
    });

    it('should reject connection from deactivated user account', async () => {
      const client = createClient(inactiveDevToken);
      const err = await waitForConnectError(client);
      expect(err.message).toMatch(/Authentication error: User account is deactivated/i);
      expect(client.connected).toBe(false);
    });

    it('should successfully authenticate with valid JWT in handshake auth and receive system:connected event', async () => {
      const client = createClient(devTokenA);
      const connectedEnvelope = await waitForEvent<SocketEventEnvelope<SystemConnectedPayload>>(
        client,
        SocketEventName.SYSTEM_CONNECTED
      );

      expect(client.connected).toBe(true);
      expect(connectedEnvelope.eventType).toBe(SocketEventName.SYSTEM_CONNECTED);
      expect(connectedEnvelope.data.userId).toBe(devUserA._id.toString());
      expect(connectedEnvelope.data.role).toBe(UserRole.DEVELOPER);
      expect(connectedEnvelope.data.socketId).toBe(client.id);
      expect(connectedEnvelope.data.serverTime).toBeDefined();
    });

    it('should successfully authenticate via Bearer Authorization header', async () => {
      const client = createClient(undefined, {
        authorization: `Bearer ${devTokenB}`,
      });

      const connectedEnvelope = await waitForEvent<SocketEventEnvelope<SystemConnectedPayload>>(
        client,
        SocketEventName.SYSTEM_CONNECTED
      );

      expect(client.connected).toBe(true);
      expect(connectedEnvelope.data.userId).toBe(devUserB._id.toString());
      expect(connectedEnvelope.data.role).toBe(UserRole.DEVELOPER);
    });
  });

  // =========================================================================
  // 2. Room Management & Strict Multi-Tenant Isolation
  // =========================================================================
  describe('2. Room Management & Strict Authorization Boundaries', () => {
    let jobAlice: any;
    let jobBob: any;

    beforeEach(async () => {
      jobAlice = await JobModel.create({
        name: 'Alice Pipeline',
        type: 'test-job',
        payload: { task: 'alice' },
        priority: 5,
        status: JobStatus.QUEUED,
        userId: devUserA._id,
        queueName: 'default',
        jobId: 'job_alice_100',
      });

      jobBob = await JobModel.create({
        name: 'Bob Pipeline',
        type: 'test-job',
        payload: { task: 'bob' },
        priority: 5,
        status: JobStatus.QUEUED,
        userId: devUserB._id,
        queueName: 'default',
        jobId: 'job_bob_200',
      });
    });

    it('should permit developer to subscribe to their own job room', async () => {
      const clientA = createClient(devTokenA);
      await waitForEvent(clientA, SocketEventName.SYSTEM_CONNECTED);

      const ack = await new Promise<any>((resolve) => {
        clientA.emit('subscribe:job', { jobId: jobAlice.jobId }, (res: any) => resolve(res));
      });

      expect(ack.success).toBe(true);
      expect(ack.jobId).toBe(jobAlice.jobId);
    });

    it('should deny and reject developer attempting to subscribe to another developer job room', async () => {
      const clientA = createClient(devTokenA);
      await waitForEvent(clientA, SocketEventName.SYSTEM_CONNECTED);

      // Listen for system:error event
      const errorPromise = waitForEvent<SocketEventEnvelope<SystemErrorPayload>>(
        clientA,
        SocketEventName.SYSTEM_ERROR
      );

      const ack = await new Promise<any>((resolve) => {
        clientA.emit('subscribe:job', { jobId: jobBob.jobId }, (res: any) => resolve(res));
      });

      expect(ack.success).toBe(false);
      expect(ack.error).toMatch(/Unauthorized/i);

      const errorEnvelope = await errorPromise;
      expect(errorEnvelope.data.code).toBe('FORBIDDEN');
      expect(errorEnvelope.data.message).toMatch(/Unauthorized access to job event room/i);
    });

    it('should deny non-admin developer from subscribing to admin:telemetry room', async () => {
      const clientA = createClient(devTokenA);
      await waitForEvent(clientA, SocketEventName.SYSTEM_CONNECTED);

      const errorPromise = waitForEvent<SocketEventEnvelope<SystemErrorPayload>>(
        clientA,
        SocketEventName.SYSTEM_ERROR
      );

      const ack = await new Promise<any>((resolve) => {
        clientA.emit('subscribe:admin:telemetry', (res: any) => resolve(res));
      });

      expect(ack.success).toBe(false);
      expect(ack.error).toMatch(/Forbidden/i);

      const errorEnvelope = await errorPromise;
      expect(errorEnvelope.data.code).toBe('FORBIDDEN');
      expect(errorEnvelope.data.message).toMatch(/Administrative role required/i);
    });

    it('should allow admin to subscribe to any developer job room and admin telemetry', async () => {
      const clientAdmin = createClient(adminToken);
      await waitForEvent(clientAdmin, SocketEventName.SYSTEM_CONNECTED);

      // Admin subscribes to Alice's job
      const ackAlice = await new Promise<any>((resolve) => {
        clientAdmin.emit('subscribe:job', { jobId: jobAlice.jobId }, (res: any) => resolve(res));
      });
      expect(ackAlice.success).toBe(true);

      // Admin subscribes to Bob's job
      const ackBob = await new Promise<any>((resolve) => {
        clientAdmin.emit('subscribe:job', { jobId: jobBob.jobId }, (res: any) => resolve(res));
      });
      expect(ackBob.success).toBe(true);

      // Admin explicitly subscribes to admin telemetry
      const ackTelemetry = await new Promise<any>((resolve) => {
        clientAdmin.emit('subscribe:admin:telemetry', (res: any) => resolve(res));
      });
      expect(ackTelemetry.success).toBe(true);
    });
  });

  // =========================================================================
  // 3. Real-Time Event Streaming & Isolation
  // =========================================================================
  describe('3. Real-Time Job Lifecycle Event Streaming', () => {
    let jobAlice: any;

    beforeEach(async () => {
      jobAlice = await JobModel.create({
        name: 'Streaming Pipeline',
        type: 'video-render',
        payload: { file: 'clip.mp4' },
        priority: 3,
        status: JobStatus.QUEUED,
        userId: devUserA._id,
        queueName: 'default',
        jobId: 'job_stream_100',
      });
    });

    it('should stream job:started and job:completed to owning developer and NOT to other developers', async () => {
      const clientA = createClient(devTokenA);
      const clientB = createClient(devTokenB);

      await Promise.all([
        waitForEvent(clientA, SocketEventName.SYSTEM_CONNECTED),
        waitForEvent(clientB, SocketEventName.SYSTEM_CONNECTED),
      ]);

      let devBReceivedStarted = false;
      clientB.on(SocketEventName.JOB_STARTED, () => {
        devBReceivedStarted = true;
      });

      const startedPromiseA = waitForEvent<SocketEventEnvelope<JobEventPayload>>(
        clientA,
        SocketEventName.JOB_STARTED
      );

      // Publish job:started for Alice's job
      await eventPublisher.publishJobEvent(SocketEventName.JOB_STARTED, {
        jobId: jobAlice.jobId,
        userId: devUserA._id.toString(),
        queueName: jobAlice.queueName,
        type: jobAlice.type,
        status: JobStatus.PROCESSING,
        priority: jobAlice.priority,
        workerId: 'worker-unit-test-1',
      });

      const startedEnvelope = await startedPromiseA;
      expect(startedEnvelope.eventType).toBe(SocketEventName.JOB_STARTED);
      expect(startedEnvelope.data.jobId).toBe(jobAlice.jobId);
      expect(startedEnvelope.data.status).toBe(JobStatus.PROCESSING);
      expect(startedEnvelope.data.workerId).toBe('worker-unit-test-1');

      // Dev B must never receive Alice's event
      expect(devBReceivedStarted).toBe(false);

      // Now publish job:completed
      const completedPromiseA = waitForEvent<SocketEventEnvelope<JobEventPayload>>(
        clientA,
        SocketEventName.JOB_COMPLETED
      );

      await eventPublisher.publishJobEvent(SocketEventName.JOB_COMPLETED, {
        jobId: jobAlice.jobId,
        userId: devUserA._id.toString(),
        queueName: jobAlice.queueName,
        type: jobAlice.type,
        status: JobStatus.COMPLETED,
        progress: 100,
        result: { rendered: true },
      });

      const completedEnvelope = await completedPromiseA;
      expect(completedEnvelope.eventType).toBe(SocketEventName.JOB_COMPLETED);
      expect(completedEnvelope.data.jobId).toBe(jobAlice.jobId);
      expect(completedEnvelope.data.status).toBe(JobStatus.COMPLETED);
      expect(completedEnvelope.data.progress).toBe(100);
      expect(completedEnvelope.data.result).toEqual({ rendered: true });
    });

    it('should stream throttled job:progress updates with progress percentage and logs', async () => {
      const clientA = createClient(devTokenA);
      await waitForEvent(clientA, SocketEventName.SYSTEM_CONNECTED);

      // Subscribe clientA to job
      await new Promise<any>((resolve) => {
        clientA.emit('subscribe:job', { jobId: jobAlice.jobId }, (res: any) => resolve(res));
      });

      const progressPromise = waitForEvent<SocketEventEnvelope<JobProgressPayload>>(
        clientA,
        SocketEventName.JOB_PROGRESS
      );

      await eventPublisher.publishProgress({
        jobId: jobAlice.jobId,
        userId: devUserA._id.toString(),
        queueName: jobAlice.queueName,
        progress: 45,
        message: 'Rendering video frames 450/1000',
        workerId: 'worker-gpu-1',
        timestamp: new Date().toISOString(),
      });

      const progressEnvelope = await progressPromise;
      expect(progressEnvelope.eventType).toBe(SocketEventName.JOB_PROGRESS);
      expect(progressEnvelope.data.jobId).toBe(jobAlice.jobId);
      expect(progressEnvelope.data.progress).toBe(45);
      expect(progressEnvelope.data.message).toBe('Rendering video frames 450/1000');
      expect(progressEnvelope.data.workerId).toBe('worker-gpu-1');
    });

    it('should enforce progress event throttling on rapid intermediate updates, but bypass on boundaries', async () => {
      const jobThrottle = await JobModel.create({
        name: 'Throttle Pipeline',
        type: 'batch-export',
        payload: { count: 50 },
        priority: 5,
        status: JobStatus.PROCESSING,
        userId: devUserA._id,
        queueName: 'default',
        jobId: 'job_throttle_unique_99',
      });

      const clientA = createClient(devTokenA);
      await waitForEvent(clientA, SocketEventName.SYSTEM_CONNECTED);

      const receivedProgresses: number[] = [];
      clientA.on(SocketEventName.JOB_PROGRESS, (envelope: SocketEventEnvelope<JobProgressPayload>) => {
        if (envelope.data.jobId === jobThrottle.jobId) {
          receivedProgresses.push(envelope.data.progress);
        }
      });

      // Rapidly fire intermediate progress events (10%, 15%, 20%) within single tick
      await eventPublisher.publishProgress({
        jobId: jobThrottle.jobId,
        userId: devUserA._id.toString(),
        queueName: jobThrottle.queueName,
        progress: 10,
        timestamp: new Date().toISOString(),
      });

      await eventPublisher.publishProgress({
        jobId: jobThrottle.jobId,
        userId: devUserA._id.toString(),
        queueName: jobThrottle.queueName,
        progress: 15,
        timestamp: new Date().toISOString(),
      });

      await eventPublisher.publishProgress({
        jobId: jobThrottle.jobId,
        userId: devUserA._id.toString(),
        queueName: jobThrottle.queueName,
        progress: 20,
        timestamp: new Date().toISOString(),
      });

      // Boundary event (100%) which must bypass throttle
      await eventPublisher.publishProgress({
        jobId: jobThrottle.jobId,
        userId: devUserA._id.toString(),
        queueName: jobThrottle.queueName,
        progress: 100,
        timestamp: new Date().toISOString(),
      });

      // Give 200ms for socket messages to arrive
      await new Promise((resolve) => setTimeout(resolve, 200));

      // 10% was sent, 15% and 20% were throttled (< 250ms), and 100% was sent (boundary)
      expect(receivedProgresses).toContain(10);
      expect(receivedProgresses).toContain(100);
      expect(receivedProgresses).not.toContain(15);
      expect(receivedProgresses).not.toContain(20);
    });
  });

  // =========================================================================
  // 4. Queue & Worker Fleet Telemetry Broadcasting
  // =========================================================================
  describe('4. Operational Telemetry Streaming', () => {
    it('should broadcast queue:stats to subscribers of the queue room', async () => {
      const clientDev = createClient(devTokenA);
      await waitForEvent(clientDev, SocketEventName.SYSTEM_CONNECTED);

      // Subscribe to queue
      const subAck = await new Promise<any>((resolve) => {
        clientDev.emit('subscribe:queue', { queueName: 'critical' }, (res: any) => resolve(res));
      });
      expect(subAck.success).toBe(true);

      const queueStatsPromise = waitForEvent<SocketEventEnvelope<QueueTelemetryPayload>>(
        clientDev,
        SocketEventName.QUEUE_STATS
      );

      await eventPublisher.publishQueueTelemetry({
        queueName: 'critical',
        waiting: 5,
        active: 2,
        delayed: 1,
        completed: 100,
        failed: 3,
        paused: false,
        timestamp: new Date().toISOString(),
      });

      const statsEnvelope = await queueStatsPromise;
      expect(statsEnvelope.eventType).toBe(SocketEventName.QUEUE_STATS);
      expect(statsEnvelope.data.queueName).toBe('critical');
      expect(statsEnvelope.data.waiting).toBe(5);
      expect(statsEnvelope.data.active).toBe(2);
      expect(statsEnvelope.data.completed).toBe(100);
    });

    it('should broadcast worker telemetry events to admin:telemetry subscribers', async () => {
      const clientAdmin = createClient(adminToken);
      await waitForEvent(clientAdmin, SocketEventName.SYSTEM_CONNECTED);

      const heartbeatPromise = waitForEvent<SocketEventEnvelope<WorkerTelemetryPayload>>(
        clientAdmin,
        SocketEventName.WORKER_HEARTBEAT
      );

      await eventPublisher.publishWorkerTelemetry(SocketEventName.WORKER_HEARTBEAT, {
        workerId: 'worker-fleet-99',
        status: WorkerStatus.HEALTHY,
        activeJobs: 3,
        concurrency: 5,
        queues: ['default', 'critical'],
        lastHeartbeat: new Date().toISOString(),
        metrics: {
          memoryRssBytes: 104857600,
          heapUsedBytes: 52428800,
          cpuPercent: 12.5,
        },
      });

      const workerEnvelope = await heartbeatPromise;
      expect(workerEnvelope.eventType).toBe(SocketEventName.WORKER_HEARTBEAT);
      expect(workerEnvelope.data.workerId).toBe('worker-fleet-99');
      expect(workerEnvelope.data.status).toBe(WorkerStatus.HEALTHY);
      expect(workerEnvelope.data.activeJobs).toBe(3);
      expect(workerEnvelope.data.metrics?.cpuPercent).toBe(12.5);
    });
  });
});
