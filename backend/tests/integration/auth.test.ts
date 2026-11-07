import request from 'supertest';
import { createApp } from '../../src/app.js';
import { UserModel } from '../../src/models/user.model.js';
import { RefreshTokenModel } from '../../src/models/refresh-token.model.js';
import {
  setupTestDatabase,
  clearTestDatabase,
  teardownTestDatabase,
} from '../helpers/db-test.helper.js';

describe('Authentication API & Lifecycle (Integration)', () => {
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

  describe('POST /api/auth/register', () => {
    const validRegistration = {
      name: 'Alice Engineer',
      email: 'alice@taskflow.dev',
      password: 'StrongPassword123!',
      role: 'developer',
    };

    it('should register a new user successfully and return tokens', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(validRegistration);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe('alice@taskflow.dev');
      expect(res.body.data.user.name).toBe('Alice Engineer');
      expect(res.body.data.user.role).toBe('developer');
      expect(res.body.data.user.passwordHash).toBeUndefined(); // Never expose passwordHash
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();

      // Verify cookie was set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toMatch(/refreshToken=/);

      // Verify password was hashed in MongoDB
      const dbUser = await UserModel.findOne({ email: 'alice@taskflow.dev' }).select('+passwordHash');
      expect(dbUser).toBeDefined();
      expect(dbUser?.passwordHash).not.toBe(validRegistration.password);
      expect(dbUser?.passwordHash.startsWith('$2b$')).toBe(true); // bcrypt signature
    });

    it('should reject duplicate email with 409 Conflict', async () => {
      await request(app).post('/api/auth/register').send(validRegistration);

      const res = await request(app).post('/api/auth/register').send(validRegistration);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('should reject invalid email format with 400 Bad Request', async () => {
      const res = await request(app).post('/api/auth/register').send({
        ...validRegistration,
        email: 'invalid-email-address',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject weak passwords (< 8 chars, missing symbols) with 400', async () => {
      const res = await request(app).post('/api/auth/register').send({
        ...validRegistration,
        password: 'weak',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Bob Architect',
        email: 'bob@taskflow.dev',
        password: 'ComplexPassword99#',
      });
    });

    it('should authenticate user with valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'bob@taskflow.dev',
        password: 'ComplexPassword99#',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('bob@taskflow.dev');
      expect(res.body.data.tokens.accessToken).toBeDefined();
    });

    it('should reject invalid password with generic 401 Unauthorized', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'bob@taskflow.dev',
        password: 'WrongPassword123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('should reject non-existent email with generic 401 Unauthorized', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'nonexistent@taskflow.dev',
        password: 'ComplexPassword99#',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Invalid email or password');
    });
  });

  describe('GET /api/auth/me', () => {
    let accessToken: string;

    beforeEach(async () => {
      const registerRes = await request(app).post('/api/auth/register').send({
        name: 'Charlie Dev',
        email: 'charlie@taskflow.dev',
        password: 'CharliePassword123!',
      });
      accessToken = registerRes.body.data.tokens.accessToken;
    });

    it('should return current user profile with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('charlie@taskflow.dev');
      expect(res.body.data.name).toBe('Charlie Dev');
    });

    it('should reject request without Bearer token with 401', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Refresh Token Rotation & Reuse Detection', () => {
    let initialRefreshToken: string;

    beforeEach(async () => {
      const regRes = await request(app).post('/api/auth/register').send({
        name: 'Dave Security',
        email: 'dave@taskflow.dev',
        password: 'DavePassword123!',
      });
      initialRefreshToken = regRes.body.data.tokens.refreshToken;
    });

    it('should rotate refresh token and issue a fresh token pair', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).not.toBe(initialRefreshToken);

      // Verify the old token is marked revoked in MongoDB
      const tokensCount = await RefreshTokenModel.countDocuments({ isRevoked: true });
      expect(tokensCount).toBe(1);
    });

    it('should detect token reuse and immediately revoke all tokens in family', async () => {
      // First rotation succeeds
      const firstRotation = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: initialRefreshToken });
      expect(firstRotation.status).toBe(200);

      // Attempt to reuse initialRefreshToken again!
      const maliciousReuse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(maliciousReuse.status).toBe(401);
      expect(maliciousReuse.body.error.message).toMatch(/Token reuse detected/);

      // Verify ALL tokens in the family are now revoked
      const activeTokensCount = await RefreshTokenModel.countDocuments({ isRevoked: false });
      expect(activeTokensCount).toBe(0);
    });

    it('should revoke token on logout', async () => {
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: initialRefreshToken });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Subsequent refresh with that token must fail
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(refreshRes.status).toBe(401);
    });
  });
});
