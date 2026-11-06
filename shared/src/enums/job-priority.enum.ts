/**
 * Predefined priority tiers for job scheduling.
 * Priority in BullMQ: 1 is the highest priority, 10 is the lowest.
 */
export enum JobPriority {
  CRITICAL = 1,
  HIGH = 2,
  NORMAL = 5,
  LOW = 8,
  BACKGROUND = 10,
}

export const MIN_JOB_PRIORITY = 1;
export const MAX_JOB_PRIORITY = 10;
export const DEFAULT_JOB_PRIORITY = JobPriority.NORMAL;

export function isValidJobPriority(priority: number): boolean {
  return Number.isInteger(priority) && priority >= MIN_JOB_PRIORITY && priority <= MAX_JOB_PRIORITY;
}
