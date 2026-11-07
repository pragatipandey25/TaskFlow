import { Request, Response, NextFunction } from 'express';
import { UserRole, hasRequiredRole } from '@taskflow/shared';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';

/**
 * Enforces that the authenticated user possesses one of the explicitly allowed roles.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required prior to authorization check');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(
        `Access forbidden: requires one of [${allowedRoles.join(', ')}], current role is '${req.user.role}'`
      );
    }

    next();
  };
}

/**
 * Enforces that the authenticated user possesses at least the minimum hierarchical role.
 * Role Hierarchy: VIEWER (1) < DEVELOPER (2) < ADMIN (3)
 */
export function requireMinimumRole(minRole: UserRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required prior to authorization check');
    }

    if (!hasRequiredRole(req.user.role, minRole)) {
      throw new ForbiddenError(
        `Access forbidden: requires minimum role of '${minRole}', current role is '${req.user.role}'`
      );
    }

    next();
  };
}
