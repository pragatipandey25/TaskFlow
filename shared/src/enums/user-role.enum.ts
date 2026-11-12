/**
 * Role-Based Access Control tiers for TaskFlow users.
 */
export enum UserRole {
  ADMIN = 'admin',
  DEVELOPER = 'developer',
  VIEWER = 'viewer',
}

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.VIEWER]: 1,
  [UserRole.DEVELOPER]: 2,
  [UserRole.ADMIN]: 3,
};

export function hasRequiredRole(userRole: UserRole, requiredRole: UserRole): boolean {
  const userLevel = ROLE_HIERARCHY[userRole];
  const requiredLevel = ROLE_HIERARCHY[requiredRole];
  if (typeof userLevel !== 'number' || typeof requiredLevel !== 'number') {
    return false;
  }
  return userLevel >= requiredLevel;
}
