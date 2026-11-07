import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { UserRole } from '@taskflow/shared';
import { env } from '../../config/env.config.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';

export interface JwtTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
}

export interface AccessTokenResult {
  accessToken: string;
  expiresInSeconds: number;
}

export interface GeneratedRefreshToken {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

// 7 days expiration in milliseconds for refresh tokens
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class TokenService {
  /**
   * Hashes a raw token string using SHA-256 for secure database storage.
   */
  public static hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Issues a short-lived JWT Access Token.
   */
  public static generateAccessToken(payload: JwtTokenPayload): AccessTokenResult {
    const options: SignOptions = {
      expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
      algorithm: 'HS256',
    };

    const accessToken = jwt.sign(payload, env.JWT_SECRET, options);
    
    // Convert 15m to seconds (e.g. 900)
    const expiresInSeconds = 15 * 60;

    return {
      accessToken,
      expiresInSeconds,
    };
  }

  /**
   * Generates a cryptographically strong random Refresh Token and its SHA-256 hash.
   */
  public static generateRefreshToken(): GeneratedRefreshToken {
    const rawToken = crypto.randomBytes(48).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    return {
      rawToken,
      tokenHash,
      expiresAt,
    };
  }

  /**
   * Cryptographically verifies and decodes a JWT Access Token.
   */
  public static verifyAccessToken(token: string): JwtTokenPayload {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
      }) as JwtTokenPayload;

      return {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      };
    } catch (err: unknown) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Access token has expired');
      }
      throw new UnauthorizedError('Invalid access token');
    }
  }
}
