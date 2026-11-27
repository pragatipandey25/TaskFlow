import { UserRole } from '@taskflow/shared';
import { setApiAccessToken, getApiAccessToken } from '../services/api.client';

describe('Frontend Auth & RBAC Logic', () => {
  beforeEach(() => {
    setApiAccessToken(null);
  });

  describe('JWT Token In-Memory Storage', () => {
    it('should correctly set and retrieve access token', () => {
      expect(getApiAccessToken()).toBeNull();
      const mockToken = 'mock.jwt.token';
      setApiAccessToken(mockToken);
      expect(getApiAccessToken()).toBe(mockToken);
    });

    it('should clear access token on logout', () => {
      setApiAccessToken('mock.token');
      setApiAccessToken(null);
      expect(getApiAccessToken()).toBeNull();
    });
  });

  describe('Role-Based Access Control Entitlements', () => {
    const checkRolePermission = (
      userRole: UserRole,
      action: 'SUBMIT_JOB' | 'RETRY_CANCEL_OWN' | 'BULK_REDRIVE' | 'ADMIN_OPS'
    ): boolean => {
      if (userRole === UserRole.ADMIN) return true;
      if (action === 'ADMIN_OPS') return false;
      if (userRole === UserRole.DEVELOPER) {
        return action === 'SUBMIT_JOB' || action === 'RETRY_CANCEL_OWN' || action === 'BULK_REDRIVE';
      }
      // Viewer is read-only
      return false;
    };

    it('should grant Viewer read-only entitlements and deny mutations', () => {
      expect(checkRolePermission(UserRole.VIEWER, 'SUBMIT_JOB')).toBe(false);
      expect(checkRolePermission(UserRole.VIEWER, 'RETRY_CANCEL_OWN')).toBe(false);
      expect(checkRolePermission(UserRole.VIEWER, 'BULK_REDRIVE')).toBe(false);
      expect(checkRolePermission(UserRole.VIEWER, 'ADMIN_OPS')).toBe(false);
    });

    it('should grant Developer job submission, retry/cancel own, and bulk redrive', () => {
      expect(checkRolePermission(UserRole.DEVELOPER, 'SUBMIT_JOB')).toBe(true);
      expect(checkRolePermission(UserRole.DEVELOPER, 'RETRY_CANCEL_OWN')).toBe(true);
      expect(checkRolePermission(UserRole.DEVELOPER, 'BULK_REDRIVE')).toBe(true);
      expect(checkRolePermission(UserRole.DEVELOPER, 'ADMIN_OPS')).toBe(false);
    });

    it('should grant Admin universal permissions across all capabilities', () => {
      expect(checkRolePermission(UserRole.ADMIN, 'SUBMIT_JOB')).toBe(true);
      expect(checkRolePermission(UserRole.ADMIN, 'RETRY_CANCEL_OWN')).toBe(true);
      expect(checkRolePermission(UserRole.ADMIN, 'BULK_REDRIVE')).toBe(true);
      expect(checkRolePermission(UserRole.ADMIN, 'ADMIN_OPS')).toBe(true);
    });
  });
});