/**
 * Complete lifecycle states of a background job in TaskFlow.
 * Enforced across MongoDB records and BullMQ queue events.
 */
export enum JobStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  DELAYED = 'DELAYED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  DEAD_LETTER = 'DEAD_LETTER',
  CANCELLED = 'CANCELLED',
}

/**
 * Valid transitions for the TaskFlow Job Finite State Machine.
 */
export const VALID_JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  [JobStatus.PENDING]: [JobStatus.QUEUED, JobStatus.DELAYED, JobStatus.CANCELLED, JobStatus.FAILED],
  [JobStatus.DELAYED]: [JobStatus.QUEUED, JobStatus.CANCELLED],
  [JobStatus.QUEUED]: [JobStatus.PROCESSING, JobStatus.CANCELLED],
  [JobStatus.PROCESSING]: [
    JobStatus.COMPLETED,
    JobStatus.RETRYING,
    JobStatus.DEAD_LETTER,
    JobStatus.CANCELLED,
    JobStatus.FAILED,
  ],
  [JobStatus.RETRYING]: [JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.CANCELLED, JobStatus.DEAD_LETTER],
  [JobStatus.DEAD_LETTER]: [JobStatus.QUEUED], // Allow manual redrive
  [JobStatus.COMPLETED]: [],
  [JobStatus.CANCELLED]: [],
  [JobStatus.FAILED]: [JobStatus.QUEUED], // Allow retry
} as const;

export function isValidJobTransition(from: JobStatus, to: JobStatus): boolean {
  return VALID_JOB_TRANSITIONS[from]?.includes(to) ?? false;
}
