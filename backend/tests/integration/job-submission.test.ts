import { jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { UserModel } from '../../src/models/user.model.js';
import { JobModel } from '../../src/models/job.model.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { queueService } from '../../src/core/queue/queue.service.js';
import { UserRole, JobStatus, JobPriority, JobType } from '@taskflow/shared';

describe('Job Management APIs (Integration)', () => {
  const app = createApp();

  let adminUser: any;
  let devUserA: any;
  let devUserB: any;
  let viewerUser: any;

  let adminToken: string;
  let devTokenA: string;
  let devTokenB: string;
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

    // Mock BullMQ queueService.addJob to avoid requiring active Redis server in tests
    jest.spyOn(queueService, 'addJob').mockImplementation(async (job) => {
      return `bull_mock_${job.jobId}`;
    });

    jest.spyOn(queueService, 'cancelJob').mockResolvedValue(true);
    jest.spyOn(queueService, 'retryJob').mockResolvedValue(true);

    // Seed test users
    adminUser = await UserModel.create({
      name: 'Admin User',
      email: 'admin@taskflow.dev',
      passwordHash: 'hash_admin',
      role: UserRole.ADMIN,
    });

    devUserA = await UserModel.create({
      name: 'Developer Alice',
      email: 'alice@taskflow.dev',
      passwordHash: 'hash_alice',
      role: UserRole.DEVELOPER,
    });

    devUserB = await UserModel.create({
      name: 'Developer Bob',
      email: 'bob@taskflow.dev',
      passwordHash: 'hash_bob',
      role: UserRole.DEVELOPER,
    });

    viewerUser = await UserModel.create({
      name: 'Viewer Charlie',
      email: 'charlie@taskflow.dev',
      passwordHash: 'hash_charlie',
      role: UserRole.VIEWER,
    });

    adminToken = TokenService.generateAccessToken({
      userId: adminUser._id.toString(),
      email: adminUser.email,
      role: adminUser.role,
    }).accessToken;

    devTokenA = TokenService.generateAccessToken({
      userId: devUserA._id.toString(),
      email: devUserA.email,
      role: devUserA.role,
    }).accessToken;

    devTokenB = TokenService.generateAccessToken({
      userId: devUserB._id.toString(),
      email: devUserB.email,
      role: devUserB.role,
    }).accessToken;

    viewerToken = TokenService.generateAccessToken({
      userId: viewerUser._id.toString(),
      email: viewerUser.email,
      role: viewerUser.role,
    }).accessToken;
  });

  describe('POST /api/jobs (Job Submission & RBAC)', () => {
    it('should reject unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ name: 'Test Job', type: JobType.EMAIL_SIMULATION, payload: {} });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject VIEWER role with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          name: 'Viewer Submit Attempt',
          type: JobType.EMAIL_SIMULATION,
          payload: { to: 'test@example.com' },
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow DEVELOPER role to submit a valid background job', async () => {
      const payload = {
        name: 'Welcome Email Job',
        type: JobType.EMAIL_SIMULATION,
        payload: { to: 'developer@taskflow.dev', subject: 'Welcome' },
        priority: JobPriority.HIGH,
        queueName: 'notifications',
        tags: ['onboarding', 'email'],
      };

      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${devTokenA}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Welcome Email Job');
      expect(res.body.data.status).toBe(JobStatus.QUEUED);
      expect(res.body.data.bullJobId).toBeDefined();
      expect(res.body.data.priority).toBe(JobPriority.HIGH);

      // Verify in MongoDB
      const jobInDb = await JobModel.findOne({ jobId: res.body.data.jobId });
      expect(jobInDb).toBeDefined();
      expect(jobInDb?.userId.toString()).toBe(devUserA._id.toString());
    });

    it('should reject invalid payload structure with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${devTokenA}`)
        .send({
          name: '',
          type: JobType.EMAIL_SIMULATION,
          priority: 99, // Invalid priority
          payload: 'not-an-object',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle idempotency key and return existing job on duplicate submission', async () => {
      const idempotencyKey = 'idemp_key_unique_test_123';
      const payload = {
        name: 'Idempotent Sync',
        type: JobType.DATA_PROCESSING,
        payload: { batchId: 42 },
        idempotencyKey,
      };

      // First submission
      const res1 = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${devTokenA}`)
        .send(payload);

      expect(res1.status).toBe(201);
      const firstJobId = res1.body.data.jobId;

      // Duplicate submission with identical idempotency key
      const res2 = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${devTokenA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(200); // 200 OK for recognized duplicate
      expect(res2.body.data.jobId).toBe(firstJobId);

      // Verify only 1 document was created in MongoDB
      const count = await JobModel.countDocuments({ idempotencyKey });
      expect(count).toBe(1);
    });
  });

  describe('GET /api/jobs (Listing & User Isolation)', () => {
    beforeEach(async () => {
      // Create jobs for Alice
      await JobModel.create([
        {
          jobId: 'alice_job_1',
          userId: devUserA._id,
          name: 'Alice Job 1',
          type: JobType.EMAIL_SIMULATION,
          payload: {},
          status: JobStatus.QUEUED,
          priority: JobPriority.NORMAL,
        },
        {
          jobId: 'alice_job_2',
          userId: devUserA._id,
          name: 'Alice Job 2',
          type: JobType.DATA_PROCESSING,
          payload: {},
          status: JobStatus.COMPLETED,
          priority: JobPriority.HIGH,
        },
      ]);

      // Create jobs for Bob
      await JobModel.create([
        {
          jobId: 'bob_job_1',
          userId: devUserB._id,
          name: 'Bob Job 1',
          type: JobType.REPORT_GENERATION,
          payload: {},
          status: JobStatus.FAILED,
          priority: JobPriority.LOW,
        },
      ]);
    });

    it('should enforce user data isolation: Alice sees ONLY her jobs', async () => {
      const res = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      const jobIds = res.body.data.map((j: any) => j.jobId);
      expect(jobIds).toContain('alice_job_1');
      expect(jobIds).toContain('alice_job_2');
      expect(jobIds).not.toContain('bob_job_1');
    });

    it('should allow ADMIN to view all jobs across users', async () => {
      const res = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
    });

    it('should filter jobs by status', async () => {
      const res = await request(app)
        .get('/api/jobs?status=COMPLETED')
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].jobId).toBe('alice_job_2');
    });
  });

  describe('GET /api/jobs/:id (Detail & Access Control)', () => {
    let aliceJob: any;

    beforeEach(async () => {
      aliceJob = await JobModel.create({
        jobId: 'alice_private_job',
        userId: devUserA._id,
        name: 'Private Analytics',
        type: JobType.DATA_PROCESSING,
        payload: { secret: 'data' },
        status: JobStatus.QUEUED,
        priority: JobPriority.NORMAL,
      });
    });

    it('should allow owner Alice to view her job', async () => {
      const res = await request(app)
        .get(`/api/jobs/${aliceJob.jobId}`)
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Private Analytics');
    });

    it('should forbid non-owner Bob from viewing Alice job with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/jobs/${aliceJob.jobId}`)
        .set('Authorization', `Bearer ${devTokenB}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should allow ADMIN to view Alice job', async () => {
      const res = await request(app)
        .get(`/api/jobs/${aliceJob.jobId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.jobId).toBe('alice_private_job');
    });
  });

  describe('POST /api/jobs/:id/cancel & POST /api/jobs/:id/retry', () => {
    it('should allow owner to cancel an active job', async () => {
      const job = await JobModel.create({
        jobId: 'cancellable_job',
        userId: devUserA._id,
        name: 'Cancellable Job',
        type: JobType.EMAIL_SIMULATION,
        payload: {},
        status: JobStatus.QUEUED,
        bullJobId: 'bull_123',
      });

      const res = await request(app)
        .post(`/api/jobs/${job.jobId}/cancel`)
        .set('Authorization', `Bearer ${devTokenA}`)
        .send({ reason: 'Operator requested abort' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(JobStatus.CANCELLED);

      const inDb = await JobModel.findById(job._id);
      expect(inDb?.status).toBe(JobStatus.CANCELLED);
      expect(inDb?.cancelledAt).toBeDefined();
    });

    it('should reject cancelling an already completed job with 400 Bad Request', async () => {
      const completedJob = await JobModel.create({
        jobId: 'completed_job',
        userId: devUserA._id,
        name: 'Done Job',
        type: JobType.EMAIL_SIMULATION,
        payload: {},
        status: JobStatus.COMPLETED,
      });

      const res = await request(app)
        .post(`/api/jobs/${completedJob.jobId}/cancel`)
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should allow manual retry of a FAILED or DEAD_LETTER job', async () => {
      const failedJob = await JobModel.create({
        jobId: 'failed_job',
        userId: devUserA._id,
        name: 'Broken Job',
        type: JobType.DATA_PROCESSING,
        payload: {},
        status: JobStatus.DEAD_LETTER,
        attemptsMade: 3,
        error: { message: 'Out of memory' },
      });

      const res = await request(app)
        .post(`/api/jobs/${failedJob.jobId}/retry`)
        .set('Authorization', `Bearer ${devTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(JobStatus.QUEUED);
      expect(res.body.data.attemptsMade).toBe(0);

      const inDb = await JobModel.findById(failedJob._id);
      expect(inDb?.status).toBe(JobStatus.QUEUED);
      expect(inDb?.attemptsMade).toBe(0);
      expect(inDb?.error?.message).toBeUndefined();
    });
  });
});
