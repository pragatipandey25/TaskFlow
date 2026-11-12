import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { UserRole } from '@taskflow/shared';
import { TokenService } from '../../modules/auth/token.service.js';
import { UserModel } from '../../models/user.model.js';
import { UnauthorizedError } from '../errors/app-error.js';

// Extend Express Request type to include authenticated user
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
      };
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export async function authenticateJwt(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication token is missing or malformed');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedError('Authentication token is missing');
    }

    const decoded = TokenService.verifyAccessToken(token);

    // Verify account status in database if MongoDB connection is active
    if (mongoose.connection.readyState === 1) {
      const user = await UserModel.findById(decoded.userId).select('isActive email role');
      if (!user) {
        throw new UnauthorizedError('User account not found');
      }

      if (!user.isActive) {
        throw new UnauthorizedError('User account is deactivated. Please contact an administrator.');
      }

      req.user = {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
      };
    } else {
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      };
    }

    next();
  } catch (err) {
    next(err);
  }
}
