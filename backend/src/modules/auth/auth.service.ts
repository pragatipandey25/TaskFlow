import crypto from 'crypto';
import mongoose from 'mongoose';
import { RegisterInput, LoginInput, AuthResponse, UserProfileResponse, UserRole } from '@taskflow/shared';
import { UserModel, hashPassword } from '../../models/user.model.js';
import { RefreshTokenModel } from '../../models/refresh-token.model.js';
import { RefreshTokenFamilyModel } from '../../models/refresh-token-family.model.js';
import { TokenService } from './token.service.js';
import { ConflictError, UnauthorizedError, NotFoundError } from '../../core/errors/app-error.js';
import { logger } from '../../core/logging/logger.js';

export class AuthService {
  /**
   * Helper that executes an operation inside a MongoDB transaction if the deployment supports it (replica set),
   * or falls back to atomic operations with concurrency guards if running on standalone MongoDB.
   */
  private static async runInTransactionOrFallback<T>(
    operation: (session?: mongoose.ClientSession) => Promise<T>
  ): Promise<T> {
    if (mongoose.connection.readyState === 1) {
      let session: mongoose.ClientSession | null = null;
      try {
        session = await mongoose.startSession();
        if (session) {
          session.startTransaction();
          const result = await operation(session);
          await session.commitTransaction();
          return result;
        }
      } catch (err: any) {
        if (session && session.inTransaction()) {
          try {
            await session.abortTransaction();
          } catch (_) {
            // ignore abort error
          }
        }
        // If MongoDB deployment is a standalone mongod without replica set, fallback cleanly
        if (
          err?.message?.includes('Transaction numbers are only allowed') ||
          err?.message?.includes('replica set')
        ) {
          logger.warn(
            'MongoDB deployment does not support replica set transactions; falling back to atomic concurrency guards'
          );
          return operation(undefined);
        }
        throw err;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    }
    return operation(undefined);
  }

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

    // Create user in MongoDB with default DEVELOPER role (public registration cannot create admin)
    const user = await UserModel.create({
      name: input.name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: UserRole.DEVELOPER,
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

    // Persist refresh token family and hashed refresh token
    await RefreshTokenFamilyModel.create({
      familyId,
      userId: user._id,
      isRevoked: false,
      expiresAt: refresh.expiresAt,
    });

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

    // Persist refresh token family and hashed refresh token
    await RefreshTokenFamilyModel.create({
      familyId,
      userId: user._id,
      isRevoked: false,
      expiresAt: refresh.expiresAt,
    });

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
   * Refreshes access token with atomic rotation, concurrency protection, and reuse detection.
   * Guarantees that no replacement token can remain active if its family is revoked.
   */
  public static async rotateRefreshToken(rawRefreshToken: string): Promise<AuthResponse> {
    const tokenHash = TokenService.hashToken(rawRefreshToken);
    const newRefresh = TokenService.generateRefreshToken();

    return AuthService.runInTransactionOrFallback(async (session) => {
      // 1. Atomic find-and-revoke: Atomically marks old token revoked and sets replacedByTokenHash
      const consumedToken = await RefreshTokenModel.findOneAndUpdate(
        {
          tokenHash,
          isRevoked: false,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            isRevoked: true,
            replacedByTokenHash: newRefresh.tokenHash,
          },
        },
        { new: false, session }
      );

      // If atomic consumption failed, determine the exact security reason
      if (!consumedToken) {
        const existingToken = await RefreshTokenModel.findOne({ tokenHash }).session(session || null);
        if (!existingToken) {
          throw new UnauthorizedError('Invalid or expired refresh token');
        }

        // Check for refresh token reuse (breach detection)
        if (existingToken.isRevoked) {
          logger.warn(
            `🚨 REFRESH TOKEN REUSE DETECTED! FamilyId: ${existingToken.familyId}, User: ${existingToken.userId}`
          );
          // Invalidate the token family state in RefreshTokenFamilyModel
          await RefreshTokenFamilyModel.updateOne(
            { familyId: existingToken.familyId },
            { $set: { isRevoked: true, revokedReason: 'ROTATION_REUSE' } },
            { session }
          );
          // Invalidate all tokens in this specific rotation family only, leaving other user sessions intact
          await RefreshTokenModel.updateMany(
            { familyId: existingToken.familyId },
            { $set: { isRevoked: true } },
            { session }
          );
          throw new UnauthorizedError('Invalid refresh token. Token reuse detected. Please log in again.');
        }

        // Explicitly check expiration even if MongoDB TTL cleanup hasn't executed
        if (existingToken.expiresAt.getTime() <= Date.now()) {
          throw new UnauthorizedError('Refresh token has expired. Please log in again.');
        }

        throw new UnauthorizedError('Invalid or expired refresh token');
      }

      // 2. Pre-check: Verify the token family has NOT been revoked
      const family = await RefreshTokenFamilyModel.findOne({
        familyId: consumedToken.familyId,
      }).session(session || null);

      if (!family || family.isRevoked) {
        // Family was already revoked! Ensure this consumed token's family is completely wiped
        await RefreshTokenModel.updateMany(
          { familyId: consumedToken.familyId },
          { $set: { isRevoked: true } },
          { session }
        );
        throw new UnauthorizedError('Invalid refresh token. Token family has been revoked. Please log in again.');
      }

      // 3. Verify user is still active in database
      const user = await UserModel.findById(consumedToken.userId).session(session || null);
      if (!user || !user.isActive) {
        throw new UnauthorizedError('User account is invalid or deactivated.');
      }

      // 4. Persist replacement token in the same rotation family
      await RefreshTokenModel.create(
        [
          {
            userId: user._id,
            tokenHash: newRefresh.tokenHash,
            familyId: consumedToken.familyId,
            expiresAt: newRefresh.expiresAt,
          },
        ],
        { session }
      );

      // 5. Critical Concurrency Post-Check (Defense in Depth against interleaving race):
      // Verify that no racing request detected reuse and marked the family revoked while we were inserting
      const latestFamilyState = await RefreshTokenFamilyModel.findOne({
        familyId: consumedToken.familyId,
      }).session(session || null);

      if (!latestFamilyState || latestFamilyState.isRevoked) {
        // A concurrent request detected reuse and marked the family revoked!
        // Immediately revoke all tokens in family so NO active descendant can survive!
        await RefreshTokenModel.updateMany(
          { familyId: consumedToken.familyId },
          { $set: { isRevoked: true } },
          { session }
        );
        throw new UnauthorizedError('Invalid refresh token. Token family has been revoked. Please log in again.');
      }

      // 6. Issue new access token
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
    });
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
        await RefreshTokenFamilyModel.updateOne(
          { familyId: tokenRecord.familyId },
          { $set: { isRevoked: true, revokedReason: 'EXPLICIT_LOGOUT' } }
        );
        await RefreshTokenModel.updateMany(
          { familyId: tokenRecord.familyId },
          { $set: { isRevoked: true } }
        );
      }
    } else if (userId) {
      // Invalidate all tokens and families for user
      await RefreshTokenFamilyModel.updateMany(
        { userId },
        { $set: { isRevoked: true, revokedReason: 'EXPLICIT_LOGOUT' } }
      );
      await RefreshTokenModel.updateMany(
        { userId },
        { $set: { isRevoked: true } }
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

  /**
   * Promotes or changes a user's role (Admin-only operation).
   */
  public static async updateUserRole(targetUserId: string, newRole: UserRole): Promise<UserProfileResponse> {
    const user = await UserModel.findById(targetUserId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    user.role = newRole;
    await user.save();

    logger.info(`User role updated: ${user.email} [${user._id}] -> ${newRole}`);
    return user.toProfile();
  }
}
