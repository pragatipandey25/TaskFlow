import { Request, Response } from 'express';
import { APISuccessResponse, AuthResponse, UserProfileResponse } from '@taskflow/shared';
import { AuthService } from './auth.service.js';
import { registerSchema, loginSchema, refreshTokenSchema } from './auth.validation.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';
import { env } from '../../config/env.config.js';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class AuthController {
  private static setRefreshTokenCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
      path: '/api/auth',
    });
  }

  private static clearRefreshTokenCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
    });
  }

  public static async register(req: Request, res: Response): Promise<void> {
    const validatedData = registerSchema.parse(req.body);
    const result = await AuthService.register(validatedData);

    if (result.tokens.refreshToken) {
      AuthController.setRefreshTokenCookie(res, result.tokens.refreshToken);
    }

    const response: APISuccessResponse<AuthResponse> = {
      success: true,
      data: result,
      message: 'User registered successfully',
    };

    res.status(201).json(response);
  }

  public static async login(req: Request, res: Response): Promise<void> {
    const validatedData = loginSchema.parse(req.body);
    const result = await AuthService.login(validatedData);

    if (result.tokens.refreshToken) {
      AuthController.setRefreshTokenCookie(res, result.tokens.refreshToken);
    }

    const response: APISuccessResponse<AuthResponse> = {
      success: true,
      data: result,
      message: 'Login successful',
    };

    res.status(200).json(response);
  }

  public static async refresh(req: Request, res: Response): Promise<void> {
    // Check both cookie and body for flexibility across browser and programmatic clients
    const bodyData = refreshTokenSchema.safeParse(req.body);
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || bodyData.data?.refreshToken;

    if (!rawRefreshToken) {
      throw new UnauthorizedError('Refresh token is required');
    }

    const result = await AuthService.rotateRefreshToken(rawRefreshToken);

    if (result.tokens.refreshToken) {
      AuthController.setRefreshTokenCookie(res, result.tokens.refreshToken);
    }

    const response: APISuccessResponse<AuthResponse> = {
      success: true,
      data: result,
      message: 'Token refreshed successfully',
    };

    res.status(200).json(response);
  }

  public static async logout(req: Request, res: Response): Promise<void> {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    const userId = req.user?.id;

    await AuthService.logout(rawRefreshToken, userId);
    AuthController.clearRefreshTokenCookie(res);

    const response: APISuccessResponse<{ message: string }> = {
      success: true,
      data: { message: 'Successfully logged out and session revoked' },
    };

    res.status(200).json(response);
  }

  public static async getMe(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('User session not found');
    }

    const userProfile = await AuthService.getCurrentUser(req.user.id);

    const response: APISuccessResponse<UserProfileResponse> = {
      success: true,
      data: userProfile,
    };

    res.status(200).json(response);
  }
}
