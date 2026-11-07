import express from 'express';
import request from 'supertest';
import { UserRole } from '@taskflow/shared';
import { authenticateJwt } from '../../src/core/middleware/auth.middleware.js';
import { requireRole, requireMinimumRole } from '../../src/core/middleware/rbac.middleware.js';
import { errorHandler } from '../../src/core/errors/error-handler.middleware.js';
import { TokenService } from '../../src/modules/auth/token.service.js';

describe('Role-Based Access Control (RBAC) Middleware (Integration)', () => {
  const app = express();
  app.use(express.json());

  // Setup test routes protected by authenticateJwt and RBAC guards
  app.get(
    '/test/admin-only',
    authenticateJwt,
    requireRole(UserRole.ADMIN),
    (_req, res) => {
      res.json({ success: true, message: 'Welcome Admin' });
    }
  );

  app.get(
    '/test/developer-min',
    authenticateJwt,
    requireMinimumRole(UserRole.DEVELOPER),
    (_req, res) => {
      res.json({ success: true, message: 'Welcome Developer or Admin' });
    }
  );

  app.get(
    '/test/viewer-min',
    authenticateJwt,
    requireMinimumRole(UserRole.VIEWER),
    (_req, res) => {
      res.json({ success: true, message: 'Welcome Any Role' });
    }
  );

  app.use(errorHandler);

  const adminToken = TokenService.generateAccessToken({
    userId: '1',
    email: 'admin@taskflow.dev',
    role: UserRole.ADMIN,
  }).accessToken;

  const devToken = TokenService.generateAccessToken({
    userId: '2',
    email: 'dev@taskflow.dev',
    role: UserRole.DEVELOPER,
  }).accessToken;

  const viewerToken = TokenService.generateAccessToken({
    userId: '3',
    email: 'viewer@taskflow.dev',
    role: UserRole.VIEWER,
  }).accessToken;

  describe('requireRole(UserRole.ADMIN)', () => {
    it('should grant access to admin users', async () => {
      const res = await request(app)
        .get('/test/admin-only')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should deny access to developer users with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/test/admin-only')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should deny access to viewer users with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/test/admin-only')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should deny unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app).get('/test/admin-only');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('requireMinimumRole(UserRole.DEVELOPER)', () => {
    it('should allow admin', async () => {
      const res = await request(app)
        .get('/test/developer-min')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('should allow developer', async () => {
      const res = await request(app)
        .get('/test/developer-min')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
    });

    it('should deny viewer with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/test/developer-min')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('requireMinimumRole(UserRole.VIEWER)', () => {
    it('should allow all authenticated roles', async () => {
      for (const token of [adminToken, devToken, viewerToken]) {
        const res = await request(app)
          .get('/test/viewer-min')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
      }
    });
  });
});
