import { jest } from '@jest/globals';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from '../helpers/db-test.helper.js';
import { workerHeartbeatService } from '../../src/core/worker/worker-heartbeat.service.js';
import { WorkerModel } from '../../src/models/worker.model.js';
import { WorkerStatus } from '@taskflow/shared';
import { disconnectRedis } from '../../src/config/redis.js';

describe('Worker Heartbeat & Watchdog Service (Unit Tests)', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    workerHeartbeatService.stopWatchdog();
    await teardownTestDatabase();
    await disconnectRedis();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.restoreAllMocks();
  });

  it('should capture accurate process system metrics snapshot', () => {
    const metrics = workerHeartbeatService.getSystemMetrics();

    expect(metrics).toBeDefined();
    expect(typeof metrics.rssMemoryBytes).toBe('number');
    expect(metrics.rssMemoryBytes).toBeGreaterThan(0);
    expect(typeof metrics.heapUsedBytes).toBe('number');
    expect(metrics.heapUsedBytes).toBeGreaterThan(0);
    expect(typeof metrics.cpuPercent).toBe('number');
    expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.cpuPercent).toBeLessThanOrEqual(100);
  });

  it('should register a worker and record periodic heartbeats', async () => {
    const workerId = 'worker-test-node-01';
    let currentJobs = 2;

    await workerHeartbeatService.startHeartbeat(
      workerId,
      ['default', 'high-priority'],
      5,
      () => currentJobs,
      60000 // Large interval so timer doesn't fire during test
    );

    const doc = await WorkerModel.findOne({ workerId });
    expect(doc).toBeDefined();
    expect(doc?.workerId).toBe(workerId);
    expect(doc?.status).toBe(WorkerStatus.HEALTHY);
    expect(doc?.concurrency).toBe(5);
    expect(doc?.activeJobCount).toBe(2);
    expect(doc?.queuesSubscribed).toEqual(['default', 'high-priority']);
    expect(doc?.systemMetrics?.heapUsedBytes).toBeGreaterThan(0);

    // Send an updated heartbeat
    currentJobs = 4;
    await workerHeartbeatService.sendHeartbeat(workerId, () => currentJobs);

    const updatedDoc = await WorkerModel.findOne({ workerId });
    expect(updatedDoc?.activeJobCount).toBe(4);
    expect(updatedDoc?.status).toBe(WorkerStatus.HEALTHY);
  });

  it('should gracefully mark a worker DEAD upon shutdown', async () => {
    const workerId = 'worker-test-node-02';

    await WorkerModel.create({
      workerId,
      hostname: 'test-host',
      pid: 1234,
      queuesSubscribed: ['default'],
      concurrency: 10,
      activeJobCount: 3,
      status: WorkerStatus.HEALTHY,
      lastHeartbeat: new Date(),
      startedAt: new Date(),
    });

    await workerHeartbeatService.stopHeartbeat(workerId);

    const doc = await WorkerModel.findOne({ workerId });
    expect(doc).toBeDefined();
    expect(doc?.status).toBe(WorkerStatus.DEAD);
    expect(doc?.activeJobCount).toBe(0);
  });

  it('should flag degraded and dead workers via stale worker detection', async () => {
    const now = Date.now();

    // 1. Healthy Worker: heartbeat 5s ago
    await WorkerModel.create({
      workerId: 'worker-healthy',
      hostname: 'host-1',
      pid: 101,
      queuesSubscribed: ['default'],
      concurrency: 5,
      activeJobCount: 1,
      status: WorkerStatus.HEALTHY,
      lastHeartbeat: new Date(now - 5000),
      startedAt: new Date(now - 60000),
    });

    // 2. Degraded Worker: heartbeat 35s ago (between 30s and 45s)
    await WorkerModel.create({
      workerId: 'worker-degraded',
      hostname: 'host-2',
      pid: 102,
      queuesSubscribed: ['default'],
      concurrency: 5,
      activeJobCount: 2,
      status: WorkerStatus.HEALTHY,
      lastHeartbeat: new Date(now - 35000),
      startedAt: new Date(now - 120000),
    });

    // 3. Dead Worker: heartbeat 60s ago (> 45s)
    await WorkerModel.create({
      workerId: 'worker-stale-dead',
      hostname: 'host-3',
      pid: 103,
      queuesSubscribed: ['default'],
      concurrency: 5,
      activeJobCount: 3,
      status: WorkerStatus.HEALTHY,
      lastHeartbeat: new Date(now - 60000),
      startedAt: new Date(now - 180000),
    });

    const result = await workerHeartbeatService.detectStaleWorkers(45000);

    expect(result.degraded).toBe(1);
    expect(result.dead).toBe(1);

    const healthyDoc = await WorkerModel.findOne({ workerId: 'worker-healthy' });
    expect(healthyDoc?.status).toBe(WorkerStatus.HEALTHY);

    const degradedDoc = await WorkerModel.findOne({ workerId: 'worker-degraded' });
    expect(degradedDoc?.status).toBe(WorkerStatus.DEGRADED);

    const deadDoc = await WorkerModel.findOne({ workerId: 'worker-stale-dead' });
    expect(deadDoc?.status).toBe(WorkerStatus.DEAD);
    expect(deadDoc?.activeJobCount).toBe(0);
  });
});
