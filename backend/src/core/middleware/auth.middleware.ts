import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@taskflow/shared';
import { TokenService } from '../../modules/auth/token.service.js';
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

export function authenticateJwt(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authentication token is missing or malformed');
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    throw new UnauthorizedError('Authentication token is missing');
  }

  const decoded = TokenService.verifyAccessToken(token);

  req.user = {
    id: decoded.userId,
    email: decoded.email,
    role: decoded.role,
  };

  next();
}
