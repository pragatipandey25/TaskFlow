import jwt from 'jsonwebtoken';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { UserRole } from '@taskflow/shared';
import { env } from '../../src/config/env.config.js';
import { UnauthorizedError } from '../../src/core/errors/app-error.js';

describe('TokenService (Unit)', () => {
  const samplePayload = {
    userId: '672b1234567890abcdef1234',
    email: 'developer@taskflow.dev',
    role: UserRole.DEVELOPER,
  };

  it('should generate a valid JWT access token with expected claims', () => {
    const { accessToken, expiresInSeconds } = TokenService.generateAccessToken(samplePayload);
    expect(typeof accessToken).toBe('string');
    expect(expiresInSeconds).toBe(900);

    const decoded = TokenService.verifyAccessToken(accessToken);
    expect(decoded.userId).toBe(samplePayload.userId);
    expect(decoded.email).toBe(samplePayload.email);
    expect(decoded.role).toBe(UserRole.DEVELOPER);
  });

  it('should reject tampered JWT access token', () => {
    const { accessToken } = TokenService.generateAccessToken(samplePayload);
    const tamperedToken = accessToken.slice(0, -5) + 'abcde';

    expect(() => TokenService.verifyAccessToken(tamperedToken)).toThrow(UnauthorizedError);
  });

  it('should reject expired JWT access token', () => {
    // Generate token with -1s expiration
    const expiredToken = jwt.sign(samplePayload, env.JWT_SECRET, { expiresIn: '-1s' });

    expect(() => TokenService.verifyAccessToken(expiredToken)).toThrow('Access token has expired');
  });

  it('should generate cryptographically strong refresh tokens and hashes', () => {
    const refresh1 = TokenService.generateRefreshToken();
    const refresh2 = TokenService.generateRefreshToken();

    expect(refresh1.rawToken).not.toBe(refresh2.rawToken);
    expect(refresh1.tokenHash).not.toBe(refresh2.tokenHash);
    expect(refresh1.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Verify deterministic hashing
    const manualHash = TokenService.hashToken(refresh1.rawToken);
    expect(refresh1.tokenHash).toBe(manualHash);
  });
});
