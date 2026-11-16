import { jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { UserModel } from '../../src/models/user.model.js';
import { WorkerModel } from '../../src/models/worker.model.js';
import { QueueModel, QueueStatus } from '../../src/models/queue.model.js';
import { JobModel } from '../../src/models/job.model.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { queueService } from '../../src/core/queue/queue.service.js';
import { UserRole, WorkerStatus, JobStatus } from '@taskflow/shared';

describe('Worker & Queue Observability APIs (Integration)', () => {
  const app = createApp();

  let adminUser: any;
  let devUser: any;
  let viewerUser: any;

  let adminToken: string;
  let devToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
    await disconnectRedis();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.restoreAllMocks();

    // Mock BullMQ queueService methods to isolate from live Redis in tests
    jest.spyOn(queueService, 'getQueueMetrics').mockResolvedValue({
      waiting: 4,
      active: 2,
      completed: 15,
      failed: 1,
      delayed: 0,
      paused: false,
    });

    // Seed test users
    adminUser = await UserModel.create({
      name: 'Admin Boss',
      email: 'admin@taskflow.dev',
      passwordHash: 'hash_admin',
      role: UserRole.ADMIN,
    });

    devUser = await UserModel.create({
      name: 'Dev Dave',
      email: 'dave@taskflow.dev',
      passwordHash: 'hash_dev',
      role: UserRole.DEVELOPER,
    });

    viewerUser = await UserModel.create({
      name: 'Viewer Val',
      email: 'val@taskflow.dev',
      passwordHash: 'hash_viewer',
      role: UserRole.VIEWER,
    });

    adminToken = TokenService.generateAccessToken({
      userId: adminUser._id.toString(),
      email: adminUser.email,
      role: adminUser.role,
    }).accessToken;

    devToken = TokenService.generateAccessToken({
      userId: devUser._id.toString(),
      email: devUser.email,
      role: devUser.role,
    }).accessToken;

    viewerToken = TokenService.generateAccessToken({
      userId: viewerUser._id.toString(),
      email: viewerUser.email,
      role: viewerUser.role,
    }).accessToken;
  });

  describe('GET /api/workers', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/workers');
      expect(res.status).toBe(401);
    });

    it('should return list of workers with system metrics to viewer', async () => {
      await WorkerModel.create({
        workerId: 'worker-node-1',
        hostname: 'node-01.cloud',
        pid: 4091,
        queuesSubscribed: ['default'],
        concurrency: 10,
        activeJobCount: 3,
        status: WorkerStatus.HEALTHY,
        lastHeartbeat: new Date(),
        startedAt: new Date(Date.now() - 3600000),
        version: '1.0.0',
        systemMetrics: {
          rssMemoryBytes: 120000000,
          heapUsedBytes: 65000000,
          cpuPercent: 12.5,
        },
      });

      const res = await request(app)
        .get('/api/workers')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].workerId).toBe('worker-node-1');
      expect(res.body.data[0].status).toBe(WorkerStatus.HEALTHY);
      expect(res.body.data[0].systemMetrics.cpuPercent).toBe(12.5);
    });
  });

  describe('GET /api/workers/:id', () => {
    it('should return 404 for unknown workerId', async () => {
      const res = await request(app)
        .get('/api/workers/unknown-worker-999')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return worker telemetry and current active jobs', async () => {
      const workerId = 'worker-node-2';
      await WorkerModel.create({
        workerId,
        hostname: 'node-02.cloud',
        pid: 5012,
        queuesSubscribed: ['default'],
        concurrency: 5,
        activeJobCount: 1,
        status: WorkerStatus.HEALTHY,
        lastHeartbeat: new Date(),
        startedAt: new Date(Date.now() - 10000),
      });

      await JobModel.create({
        jobId: 'job-active-01',
        userId: devUser._id,
        name: 'Process Video',
        type: 'DEMO_DATA_SYNC',
        payload: { file: 'test.mp4' },
        status: JobStatus.PROCESSING,
        lockedBy: workerId,
        startedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/workers/${workerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.workerId).toBe(workerId);
      expect(res.body.data.currentJobs.length).toBe(1);
      expect(res.body.data.currentJobs[0].jobId).toBe('job-active-01');
    });
  });

  describe('Queue Management & Observability', () => {
    it('should permit only admins to create new queues', async () => {
      const payload = {
        name: 'transcoding-queue',
        description: 'Video transcoding',
        defaultPriority: 2,
        maxConcurrency: 8,
      };

      // Developer attempt should fail with 403
      const devRes = await request(app)
        .post('/api/queues')
        .set('Authorization', `Bearer ${devToken}`)
        .send(payload);
      expect(devRes.status).toBe(403);

      // Admin attempt should succeed with 201
      const adminRes = await request(app)
        .post('/api/queues')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);
      expect(adminRes.status).toBe(201);
      expect(adminRes.body.success).toBe(true);
      expect(adminRes.body.data.name).toBe('transcoding-queue');
      expect(adminRes.body.data.maxConcurrency).toBe(8);

      // Duplicate queue creation should conflict with 409
      const dupRes = await request(app)
        .post('/api/queues')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);
      expect(dupRes.status).toBe(409);
    });

    it('should list all queues with job counts', async () => {
      await QueueModel.create({
        name: 'notifications-queue',
        description: 'Outbound email queue',
        defaultPriority: 4,
        maxConcurrency: 10,
        status: QueueStatus.ACTIVE,
        createdBy: adminUser._id,
      });

      const res = await request(app)
        .get('/api/queues')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const queue = res.body.data.find((q: any) => q.name === 'notifications-queue');
      expect(queue).toBeDefined();
      expect(queue.jobCounts.waiting).toBe(4);
      expect(queue.jobCounts.active).toBe(2);
    });

    it('should return real-time queue statistics, throughput, and estimated wait time', async () => {
      const queueDoc = await QueueModel.create({
        name: 'analytics-queue',
        maxConcurrency: 4,
        status: QueueStatus.ACTIVE,
        createdBy: adminUser._id,
      });

      // Seed recent completed and failed jobs
      await JobModel.create({
        jobId: 'job-comp-1',
        userId: adminUser._id,
        queueName: 'analytics-queue',
        name: 'Report 1',
        type: 'DEMO_DATA_SYNC',
        payload: {},
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
      });

      await JobModel.create({
        jobId: 'job-fail-1',
        userId: adminUser._id,
        queueName: 'analytics-queue',
        name: 'Report 2',
        type: 'DEMO_DATA_SYNC',
        payload: {},
        status: JobStatus.DEAD_LETTER,
        failedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/queues/${queueDoc._id}/stats`)
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.queueId).toBe(queueDoc._id.toString());
      expect(res.body.data.counts.waiting).toBe(4);
      expect(res.body.data.throughput.completedLastMinute).toBe(1);
      expect(res.body.data.throughput.failedLastMinute).toBe(1);
      expect(res.body.data.estimatedWaitTimeMs).toBeGreaterThan(0);
    });
  });
});
