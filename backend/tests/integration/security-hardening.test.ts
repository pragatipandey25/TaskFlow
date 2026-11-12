import request from 'supertest';
import crypto from 'crypto';
import { UserRole } from '@taskflow/shared';
import { createApp } from '../../src/app.js';
import { UserModel, getBcryptRounds, BCRYPT_SALT_ROUNDS } from '../../src/models/user.model.js';
import { RefreshTokenModel } from '../../src/models/refresh-token.model.js';
import { RefreshTokenFamilyModel } from '../../src/models/refresh-token-family.model.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { validateEnv } from '../../src/config/env.config.js';
import {
  setupTestDatabase,
  clearTestDatabase,
  teardownTestDatabase,
} from '../helpers/db-test.helper.js';

describe('Milestone 2 Security Review & Hardening Integration Suite', () => {
  const app = createApp();

  beforeAll(async () => {
    await setupTestDatabase();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('1. Critical: Prevent Public Admin Registration', () => {
    it('must ignore client-supplied "role": "admin" and assign DEVELOPER role', async () => {
      const maliciousPayload = {
        name: 'Malicious Actor',
        email: 'attacker@exploit.dev',
        password: 'AttackerPassword123!',
        role: 'admin', // Attempted privilege escalation
      };

      const res = await request(app)
        .post('/api/auth/register')
        .send(maliciousPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe(UserRole.DEVELOPER);

      // Verify in MongoDB database that role is strictly developer
      const dbUser = await UserModel.findOne({ email: 'attacker@exploit.dev' });
      expect(dbUser).toBeDefined();
      expect(dbUser?.role).toBe(UserRole.DEVELOPER);
    });

    it('must ignore any arbitrary role value and default to DEVELOPER', async () => {
      const payload = {
        name: 'Curious User',
        email: 'curious@exploit.dev',
        password: 'CuriousPassword123!',
        role: 'superadmin',
      };

      const res = await request(app)
        .post('/api/auth/register')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe(UserRole.DEVELOPER);

      const dbUser = await UserModel.findOne({ email: 'curious@exploit.dev' });
      expect(dbUser?.role).toBe(UserRole.DEVELOPER);
    });
  });

  describe('2. Inactive Account Enforcement', () => {
    let inactiveUserId: string;

    beforeEach(async () => {
      // Register and deactivate user in database
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Disabled User',
        email: 'disabled@taskflow.dev',
        password: 'ValidPassword123!',
      });
      inactiveUserId = regRes.body.data.user.id;

      await UserModel.findByIdAndUpdate(inactiveUserId, { isActive: false });
    });

    it('must reject login attempt for deactivated account with 401 Unauthorized', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'disabled@taskflow.dev',
        password: 'ValidPassword123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/deactivated/i);
    });

    it('must reject refresh token request for deactivated account with 401 Unauthorized', async () => {
      // Generate a valid refresh token for the deactivated user
      const rawToken = crypto.randomBytes(48).toString('base64url');
      const tokenHash = TokenService.hashToken(rawToken);
      const familyId = crypto.randomUUID();

      await RefreshTokenFamilyModel.create({
        familyId,
        userId: inactiveUserId,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await RefreshTokenModel.create({
        userId: inactiveUserId,
        tokenHash,
        familyId,
        isRevoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: rawToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/deactivated/i);
    });

    it('must block access to protected endpoints even with valid JWT when account is deactivated', async () => {
      // Issue a valid JWT signed for the deactivated user
      const validJwt = TokenService.generateAccessToken({
        userId: inactiveUserId,
        email: 'disabled@taskflow.dev',
        role: UserRole.DEVELOPER,
      }).accessToken;

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validJwt}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/deactivated/i);
    });
  });

  describe('3. Refresh Token Rotation & Advanced Concurrency Verification', () => {
    it('must reject expired refresh tokens even if MongoDB TTL background worker has not run', async () => {
      const user = await UserModel.create({
        name: 'Expiry Tester',
        email: 'expiry@taskflow.dev',
        passwordHash: 'dummyhash',
        role: UserRole.DEVELOPER,
        isActive: true,
      });

      const expiredRawToken = crypto.randomBytes(48).toString('base64url');
      const tokenHash = TokenService.hashToken(expiredRawToken);
      const familyId = crypto.randomUUID();

      await RefreshTokenFamilyModel.create({
        familyId,
        userId: user._id,
        isRevoked: false,
        expiresAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      // Token expired 10 minutes ago
      await RefreshTokenModel.create({
        userId: user._id,
        tokenHash,
        familyId,
        isRevoked: false,
        expiresAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: expiredRawToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/expired/i);
    });

    it('must atomically process 2 simultaneous refresh requests so exactly one succeeds and DB state is consistent', async () => {
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Concurrency Tester',
        email: 'concurrency@taskflow.dev',
        password: 'PasswordConcurrency123!',
      });
      const initialRefreshToken = regRes.body.data.tokens.refreshToken;

      // Extract familyId from database
      const initialRecord = await RefreshTokenModel.findOne({
        tokenHash: TokenService.hashToken(initialRefreshToken),
      });
      const familyId = initialRecord!.familyId;

      // Send 2 simultaneous refresh requests with the EXACT SAME refresh token
      const [res1, res2] = await Promise.all([
        request(app).post('/api/auth/refresh').send({ refreshToken: initialRefreshToken }),
        request(app).post('/api/auth/refresh').send({ refreshToken: initialRefreshToken }),
      ]);

      const statuses = [res1.status, res2.status];
      // Exactly one request must receive 200 OK, the other must receive 401 Unauthorized
      expect(statuses).toContain(200);
      expect(statuses).toContain(401);

      // Deep Database Inspection:
      // In the database, there must never be more than 1 active token in this family
      const activeTokens = await RefreshTokenModel.find({ familyId, isRevoked: false });
      expect(activeTokens.length).toBeLessThanOrEqual(1);

      // The consumed initial token must definitely be marked revoked
      const consumedRecord = await RefreshTokenModel.findOne({
        tokenHash: TokenService.hashToken(initialRefreshToken),
      });
      expect(consumedRecord?.isRevoked).toBe(true);
    });

    it('must prevent race condition where family revocation occurs before replacement token insertion', async () => {
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Race Victim',
        email: 'racevictim@taskflow.dev',
        password: 'PasswordRace123!',
      });
      const token1 = regRes.body.data.tokens.refreshToken;
      const token1Hash = TokenService.hashToken(token1);
      const token1Record = await RefreshTokenModel.findOne({ tokenHash: token1Hash });
      const familyId = token1Record!.familyId;

      // Simulate Request B detecting reuse and revoking the family BEFORE or DURING Request A's insertion:
      await RefreshTokenFamilyModel.updateOne(
        { familyId },
        { $set: { isRevoked: true, revokedReason: 'ROTATION_REUSE' } }
      );
      await RefreshTokenModel.updateMany({ familyId }, { $set: { isRevoked: true } });

      // Now Request A attempts to complete rotation on this revoked family:
      await expect(AuthService.rotateRefreshToken(token1)).rejects.toThrow(
        /Token (reuse detected|family has been revoked)/
      );

      // Critical Invariant: Inspect MongoDB records
      // NO active descendant can survive a family revocation!
      const activeDescendants = await RefreshTokenModel.find({ familyId, isRevoked: false });
      expect(activeDescendants.length).toBe(0);

      const familyDoc = await RefreshTokenFamilyModel.findOne({ familyId });
      expect(familyDoc?.isRevoked).toBe(true);
    });

    it('must isolate token families so breach detection in one session does not revoke unrelated sessions', async () => {
      // 1. User registers -> Session 1 (Family 1)
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Multi Session User',
        email: 'multisession@taskflow.dev',
        password: 'MultiSessionPass123!',
      });
      const session1Token = regRes.body.data.tokens.refreshToken;
      const rec1 = await RefreshTokenModel.findOne({
        tokenHash: TokenService.hashToken(session1Token),
      });
      const family1Id = rec1!.familyId;

      // 2. User logs in on second device -> Session 2 (Family 2)
      const loginRes = await request(app).post('/api/auth/login').send({
        email: 'multisession@taskflow.dev',
        password: 'MultiSessionPass123!',
      });
      const session2Token = loginRes.body.data.tokens.refreshToken;
      const rec2 = await RefreshTokenModel.findOne({
        tokenHash: TokenService.hashToken(session2Token),
      });
      const family2Id = rec2!.familyId;

      expect(family1Id).not.toBe(family2Id);

      // 3. Normal rotation on Session 1
      const rotateSession1 = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: session1Token });
      expect(rotateSession1.status).toBe(200);

      // 4. Malicious reuse attempt using the already consumed session1Token
      const reuseRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: session1Token });
      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.error.message).toMatch(/Token reuse detected/);

      // Inspect MongoDB for Family 1: Must be completely revoked
      const family1Doc = await RefreshTokenFamilyModel.findOne({ familyId: family1Id });
      expect(family1Doc?.isRevoked).toBe(true);
      const activeTokensFamily1 = await RefreshTokenModel.find({
        familyId: family1Id,
        isRevoked: false,
      });
      expect(activeTokensFamily1.length).toBe(0);

      // Inspect MongoDB for Family 2: Must be ACTIVE and unaffected!
      const family2Doc = await RefreshTokenFamilyModel.findOne({ familyId: family2Id });
      expect(family2Doc?.isRevoked).toBe(false);
      const activeTokensFamily2 = await RefreshTokenModel.find({
        familyId: family2Id,
        isRevoked: false,
      });
      expect(activeTokensFamily2.length).toBe(1);

      // 5. Session 2 (Family 2) MUST STILL BE VALID and operational via HTTP
      const session2Refresh = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: session2Token });

      expect(session2Refresh.status).toBe(200);
      expect(session2Refresh.body.success).toBe(true);
      expect(session2Refresh.body.data.tokens.accessToken).toBeDefined();
    });
  });

  describe('4. Cookie & CSRF Security Verification', () => {
    it('must set HttpOnly, Path=/api/auth, and SameSite=Strict on login cookie', async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Cookie User',
        email: 'cookie@taskflow.dev',
        password: 'CookiePassword123!',
      });

      const res = await request(app).post('/api/auth/login').send({
        email: 'cookie@taskflow.dev',
        password: 'CookiePassword123!',
      });

      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = cookies[0];

      expect(cookieStr).toMatch(/HttpOnly/i);
      expect(cookieStr).toMatch(/Path=\/api\/auth/i);
      expect(cookieStr).toMatch(/SameSite=Strict/i);
    });

    it('must block cross-origin cookie refresh requests with 403 Forbidden (CSRF protection)', async () => {
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'CSRF Target',
        email: 'csrf-target@taskflow.dev',
        password: 'CsrfPassword123!',
      });
      const refreshToken = regRes.body.data.tokens.refreshToken;

      // Malicious origin attempting cookie-authenticated refresh
      const maliciousRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`])
        .set('Origin', 'http://malicious-attacker-site.com');

      expect(maliciousRes.status).toBe(403);
      expect(maliciousRes.body.success).toBe(false);
      expect(maliciousRes.body.error.message).toMatch(/CSRF protection: Request origin.*unauthorized/i);
    });

    it('must allow cookie refresh requests originating from authorized CORS_ORIGIN', async () => {
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Legit User',
        email: 'legit@taskflow.dev',
        password: 'LegitPassword123!',
      });
      const refreshToken = regRes.body.data.tokens.refreshToken;

      const legitRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`])
        .set('Origin', 'http://localhost:5173');

      expect(legitRes.status).toBe(200);
      expect(legitRes.body.success).toBe(true);
    });

    it('must continue to allow programmatic JSON-body refresh clients without cookies', async () => {
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'API Client User',
        email: 'api-client@taskflow.dev',
        password: 'ApiClientPassword123!',
      });
      const refreshToken = regRes.body.data.tokens.refreshToken;

      // Programmatic client sends refreshToken in JSON body without cookie or Origin header
      const apiRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(apiRes.status).toBe(200);
      expect(apiRes.body.success).toBe(true);
      expect(apiRes.body.data.tokens.accessToken).toBeDefined();
    });

    it('must clear cookie with matching options on logout', async () => {
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Logout Cookie User',
        email: 'logoutcookie@taskflow.dev',
        password: 'LogoutPassword123!',
      });
      const refreshToken = regRes.body.data.tokens.refreshToken;

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`refreshToken=${refreshToken}`]);

      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = cookies[0];

      // Verify cookie is cleared with identical path and security flags
      expect(cookieStr).toMatch(/refreshToken=;/);
      expect(cookieStr).toMatch(/Path=\/api\/auth/i);
      expect(cookieStr).toMatch(/SameSite=Strict/i);
    });
  });

  describe('5. Role Promotion & Administrative Operations', () => {
    let devToken: string;
    let targetUserId: string;

    beforeEach(async () => {
      // Create regular developer user
      const devRes = await request(app).post('/api/auth/register').send({
        name: 'Standard Developer',
        email: 'dev@taskflow.dev',
        password: 'DevPassword123!',
      });
      devToken = devRes.body.data.tokens.accessToken;

      // Create target user to be promoted
      const targetRes = await request(app).post('/api/auth/register').send({
        name: 'Target User',
        email: 'target@taskflow.dev',
        password: 'TargetPassword123!',
      });
      targetUserId = targetRes.body.data.user.id;
    });

    it('must reject unauthenticated role update requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .patch(`/api/auth/users/${targetUserId}/role`)
        .send({ role: UserRole.ADMIN });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('must reject non-admin (developer) role update requests with 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/auth/users/${targetUserId}/role`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({ role: UserRole.ADMIN });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // Verify target user was NOT promoted
      const dbTarget = await UserModel.findById(targetUserId);
      expect(dbTarget?.role).toBe(UserRole.DEVELOPER);
    });

    it('must allow authenticated admin to promote a user to admin', async () => {
      // Create an admin user directly
      const admin = await UserModel.create({
        name: 'System Admin',
        email: 'admin@taskflow.dev',
        passwordHash: 'dummyhash',
        role: UserRole.ADMIN,
        isActive: true,
      });

      const adminToken = TokenService.generateAccessToken({
        userId: admin._id.toString(),
        email: admin.email,
        role: admin.role,
      }).accessToken;

      const res = await request(app)
        .patch(`/api/auth/users/${targetUserId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: UserRole.ADMIN });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe(UserRole.ADMIN);

      // Verify in MongoDB
      const dbTarget = await UserModel.findById(targetUserId);
      expect(dbTarget?.role).toBe(UserRole.ADMIN);
    });

    it('must reject invalid or malformed role assignments with 400 Validation Error', async () => {
      const admin = await UserModel.create({
        name: 'System Admin 2',
        email: 'admin2@taskflow.dev',
        passwordHash: 'dummyhash',
        role: UserRole.ADMIN,
        isActive: true,
      });

      const adminToken = TokenService.generateAccessToken({
        userId: admin._id.toString(),
        email: admin.email,
        role: admin.role,
      }).accessToken;

      const res = await request(app)
        .patch(`/api/auth/users/${targetUserId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'super-root-hacker' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('6. Password & Secret Handling Configuration', () => {
    it('must use reduced bcrypt salt rounds (4) exclusively in test environment and 12 in production', () => {
      expect(BCRYPT_SALT_ROUNDS).toBe(4);
      expect(getBcryptRounds('test')).toBe(4);
      expect(getBcryptRounds('production')).toBe(12);
      expect(getBcryptRounds('development')).toBe(12);
    });

    it('must reject production deployment when default or weak JWT secrets are provided', () => {
      // Default development secret in production should throw validation error
      expect(() => {
        validateEnv({
          NODE_ENV: 'production',
          PORT: '5000',
          MONGO_URI: 'mongodb://localhost:27017/prod',
          JWT_SECRET: 'taskflow_default_development_secret_key_12345',
          JWT_REFRESH_SECRET: 'a_very_secure_production_refresh_secret_at_least_32_chars',
        });
      }).toThrow(/JWT_SECRET must be explicitly configured/);

      // Secret shorter than 32 chars in production should throw validation error
      expect(() => {
        validateEnv({
          NODE_ENV: 'production',
          PORT: '5000',
          MONGO_URI: 'mongodb://localhost:27017/prod',
          JWT_SECRET: 'short_secret_123',
          JWT_REFRESH_SECRET: 'a_very_secure_production_refresh_secret_at_least_32_chars',
        });
      }).toThrow();

      // Strong custom secret of 32+ characters in production must pass validation
      const validProdConfig = validateEnv({
        NODE_ENV: 'production',
        PORT: '5000',
        MONGO_URI: 'mongodb://localhost:27017/prod',
        JWT_SECRET: 'production_super_secret_jwt_signing_key_taskflow_secure_123456789',
        JWT_REFRESH_SECRET: 'production_super_secret_refresh_signing_key_taskflow_secure_123456789',
      });
      expect(validProdConfig.JWT_SECRET).toBe(
        'production_super_secret_jwt_signing_key_taskflow_secure_123456789'
      );
    });
  });
});
