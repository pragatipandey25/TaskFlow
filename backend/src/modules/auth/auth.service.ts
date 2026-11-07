import crypto from 'crypto';
import { RegisterInput, LoginInput, AuthResponse, UserProfileResponse } from '@taskflow/shared';
import { UserModel, hashPassword } from '../../models/user.model.js';
import { RefreshTokenModel } from '../../models/refresh-token.model.js';
import { TokenService } from './token.service.js';
import { ConflictError, UnauthorizedError, NotFoundError } from '../../core/errors/app-error.js';
import { logger } from '../../core/logging/logger.js';

export class AuthService {
  /**
   * Registers a new user account with hashed password and initial tokens.
   */
  public static async register(input: RegisterInput): Promise<AuthResponse> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // Check for existing user
    const existingUser = await UserModel.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw new ConflictError('A user with this email address already exists');
    }

    // Hash password with bcrypt (12 rounds)
    const passwordHash = await hashPassword(input.password);

    // Create user in MongoDB
    const user = await UserModel.create({
      name: input.name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: input.role,
      lastLoginAt: new Date(),
    });

    // Generate token pair with a new familyId
    const familyId = crypto.randomUUID();
    const access = TokenService.generateAccessToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    });
    const refresh = TokenService.generateRefreshToken();

    // Persist hashed refresh token
    await RefreshTokenModel.create({
      userId: user._id,
      tokenHash: refresh.tokenHash,
      familyId,
      expiresAt: refresh.expiresAt,
    });

    logger.info(`User registered successfully: ${user.email} [${user._id}]`);

    return {
      user: user.toProfile(),
      tokens: {
        accessToken: access.accessToken,
        expiresIn: access.expiresInSeconds,
        refreshToken: refresh.rawToken,
      },
    };
  }

  /**
   * Authenticates user with email and password, returning tokens.
   */
  public static async login(input: LoginInput): Promise<AuthResponse> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // Explicitly query passwordHash which is select: false by default
    const user = await UserModel.findOne({ email: normalizedEmail }).select('+passwordHash');
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('User account is deactivated. Please contact an administrator.');
    }

    // Verify bcrypt password hash
    const isPasswordValid = await user.comparePassword(input.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Update lastLoginAt
    user.lastLoginAt = new Date();
    await user.save();

    // Generate new token pair with a new rotation familyId
    const familyId = crypto.randomUUID();
    const access = TokenService.generateAccessToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    });
    const refresh = TokenService.generateRefreshToken();

    // Persist hashed refresh token
    await RefreshTokenModel.create({
      userId: user._id,
      tokenHash: refresh.tokenHash,
      familyId,
      expiresAt: refresh.expiresAt,
    });

    logger.info(`User logged in: ${user.email} [${user._id}]`);

    return {
      user: user.toProfile(),
      tokens: {
        accessToken: access.accessToken,
        expiresIn: access.expiresInSeconds,
        refreshToken: refresh.rawToken,
      },
    };
  }

  /**
   * Refreshes access token with secure rotation and reuse detection.
   */
  public static async rotateRefreshToken(rawRefreshToken: string): Promise<AuthResponse> {
    const tokenHash = TokenService.hashToken(rawRefreshToken);

    // Look up token by its SHA-256 hash
    const tokenRecord = await RefreshTokenModel.findOne({ tokenHash });
    if (!tokenRecord) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Check for refresh token reuse (breach detection)
    if (tokenRecord.isRevoked) {
      logger.warn(
        `🚨 REFRESH TOKEN REUSE DETECTED! FamilyId: ${tokenRecord.familyId}, User: ${tokenRecord.userId}`
      );
      // Immediately invalidate all tokens in this rotation family
      await RefreshTokenModel.updateMany(
        { familyId: tokenRecord.familyId },
        { isRevoked: true }
      );
      throw new UnauthorizedError('Invalid refresh token. Token reuse detected. Please log in again.');
    }

    // Check expiration
    if (tokenRecord.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('Refresh token has expired. Please log in again.');
    }

    // Verify user is still active
    const user = await UserModel.findById(tokenRecord.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('User account is invalid or deactivated.');
    }

    // Rotate: Issue new refresh token within the same family
    const newRefresh = TokenService.generateRefreshToken();

    // Revoke the old token and point to replacement
    tokenRecord.isRevoked = true;
    tokenRecord.replacedByTokenHash = newRefresh.tokenHash;
    await tokenRecord.save();

    // Save the new token in the same family
    await RefreshTokenModel.create({
      userId: user._id,
      tokenHash: newRefresh.tokenHash,
      familyId: tokenRecord.familyId,
      expiresAt: newRefresh.expiresAt,
    });

    // Issue new access token
    const access = TokenService.generateAccessToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    return {
      user: user.toProfile(),
      tokens: {
        accessToken: access.accessToken,
        expiresIn: access.expiresInSeconds,
        refreshToken: newRefresh.rawToken,
      },
    };
  }

  /**
   * Revokes refresh token on user logout.
   */
  public static async logout(rawRefreshToken?: string, userId?: string): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = TokenService.hashToken(rawRefreshToken);
      const tokenRecord = await RefreshTokenModel.findOne({ tokenHash });
      if (tokenRecord) {
        // Invalidate entire family on explicit logout
        await RefreshTokenModel.updateMany(
          { familyId: tokenRecord.familyId },
          { isRevoked: true }
        );
      }
    } else if (userId) {
      // Invalidate all tokens for user
      await RefreshTokenModel.updateMany(
        { userId },
        { isRevoked: true }
      );
    }
  }

  /**
   * Retrieves user profile by user ID.
   */
  public static async getCurrentUser(userId: string): Promise<UserProfileResponse> {
    const user = await UserModel.findById(userId);
    if (!user || !user.isActive) {
      throw new NotFoundError('User not found or account is deactivated');
    }
    return user.toProfile();
  }
}
