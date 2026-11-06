import request from 'supertest';
import { createApp } from '../../src/app.js';
import { disconnectRedis } from '../../src/config/redis.js';
import { disconnectDatabase } from '../../src/config/database.js';

describe('Health & Diagnostic Endpoints (Integration)', () => {
  const app = createApp();

  afterAll(async () => {
    await disconnectRedis();
    await disconnectDatabase();
  });

  describe('GET /api/health (Liveness Probe)', () => {
    it('should return 200 OK with basic service health details', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.status).toBe('healthy');
      expect(typeof res.body.data.uptimeSeconds).toBe('number');
      expect(res.body.data.version).toBe('1.0.0');
      expect(res.body.data.memory).toBeDefined();
      expect(res.headers['x-correlation-id']).toBeDefined();
    });
  });

  describe('GET /api/health/ready (Readiness Probe)', () => {
    it('should return dependencies state structure', async () => {
      const res = await request(app).get('/api/health/ready');

      // In unit test environment without real DB, it can be degraded or unhealthy, returning valid diagnostic payload
      expect([200, 503]).toContain(res.status);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dependencies).toBeDefined();
      expect(res.body.data.dependencies.mongodb).toBeDefined();
      expect(res.body.data.dependencies.redis).toBeDefined();
    });
  });

  describe('404 Route Handling', () => {
    it('should return 404 with standard RFC 7807 error shape for non-existent routes', async () => {
      const res = await request(app).get('/api/non-existent-endpoint');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.timestamp).toBeDefined();
    });
  });
});
