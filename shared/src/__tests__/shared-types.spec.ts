import {
  JobStatus,
  isValidJobTransition,
  JobPriority,
  isValidJobPriority,
  UserRole,
  hasRequiredRole,
} from '../index.js';

describe('Shared Core Types & Enums', () => {
  describe('JobStatus & State Machine Transitions', () => {
    it('should validate legal transitions from PENDING', () => {
      expect(isValidJobTransition(JobStatus.PENDING, JobStatus.QUEUED)).toBe(true);
      expect(isValidJobTransition(JobStatus.PENDING, JobStatus.CANCELLED)).toBe(true);
      expect(isValidJobTransition(JobStatus.PENDING, JobStatus.COMPLETED)).toBe(false);
    });

    it('should validate legal transitions from PROCESSING', () => {
      expect(isValidJobTransition(JobStatus.PROCESSING, JobStatus.COMPLETED)).toBe(true);
      expect(isValidJobTransition(JobStatus.PROCESSING, JobStatus.RETRYING)).toBe(true);
      expect(isValidJobTransition(JobStatus.PROCESSING, JobStatus.DEAD_LETTER)).toBe(true);
      expect(isValidJobTransition(JobStatus.PROCESSING, JobStatus.PENDING)).toBe(false);
    });

    it('should forbid transitions from terminal states', () => {
      expect(isValidJobTransition(JobStatus.COMPLETED, JobStatus.PROCESSING)).toBe(false);
      expect(isValidJobTransition(JobStatus.CANCELLED, JobStatus.QUEUED)).toBe(false);
    });

    it('should allow manual redrive from DEAD_LETTER to QUEUED', () => {
      expect(isValidJobTransition(JobStatus.DEAD_LETTER, JobStatus.QUEUED)).toBe(true);
      expect(isValidJobTransition(JobStatus.DEAD_LETTER, JobStatus.PROCESSING)).toBe(false);
    });
  });

  describe('JobPriority Validation', () => {
    it('should validate valid priorities between 1 and 10', () => {
      expect(isValidJobPriority(JobPriority.CRITICAL)).toBe(true);
      expect(isValidJobPriority(1)).toBe(true);
      expect(isValidJobPriority(5)).toBe(true);
      expect(isValidJobPriority(10)).toBe(true);
    });

    it('should reject invalid priorities outside 1-10 range or non-integers', () => {
      expect(isValidJobPriority(0)).toBe(false);
      expect(isValidJobPriority(11)).toBe(false);
      expect(isValidJobPriority(-1)).toBe(false);
      expect(isValidJobPriority(3.5)).toBe(false);
    });
  });

  describe('UserRole & RBAC Hierarchy', () => {
    it('should enforce role hierarchy correctly', () => {
      // Admin has access to admin, developer, viewer
      expect(hasRequiredRole(UserRole.ADMIN, UserRole.ADMIN)).toBe(true);
      expect(hasRequiredRole(UserRole.ADMIN, UserRole.DEVELOPER)).toBe(true);
      expect(hasRequiredRole(UserRole.ADMIN, UserRole.VIEWER)).toBe(true);

      // Developer has access to developer and viewer, but not admin
      expect(hasRequiredRole(UserRole.DEVELOPER, UserRole.ADMIN)).toBe(false);
      expect(hasRequiredRole(UserRole.DEVELOPER, UserRole.DEVELOPER)).toBe(true);
      expect(hasRequiredRole(UserRole.DEVELOPER, UserRole.VIEWER)).toBe(true);

      // Viewer only has access to viewer
      expect(hasRequiredRole(UserRole.VIEWER, UserRole.ADMIN)).toBe(false);
      expect(hasRequiredRole(UserRole.VIEWER, UserRole.DEVELOPER)).toBe(false);
      expect(hasRequiredRole(UserRole.VIEWER, UserRole.VIEWER)).toBe(true);

      // Malformed or unexpected roles should strictly evaluate to false
      expect(hasRequiredRole('superadmin' as UserRole, UserRole.DEVELOPER)).toBe(false);
      expect(hasRequiredRole(UserRole.ADMIN, 'superadmin' as UserRole)).toBe(false);
      expect(hasRequiredRole('' as UserRole, UserRole.VIEWER)).toBe(false);
      expect(hasRequiredRole(undefined as unknown as UserRole, UserRole.VIEWER)).toBe(false);
    });
  });
});
