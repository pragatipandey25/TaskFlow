import {
  createJobSchema,
  listJobsQuerySchema,
  jobIdParamSchema,
} from '../../src/modules/jobs/job.validation.js';
import { JobType, JobPriority, JobStatus } from '@taskflow/shared';

describe('Job Submission & Query Validation (Unit)', () => {
  describe('createJobSchema', () => {
    it('should accept valid job submission input', () => {
      const input = {
        name: 'Daily Sync Job',
        type: JobType.DATA_PROCESSING,
        payload: {
          items: [{ id: 1, value: 50 }],
          operation: 'aggregate',
        },
        priority: JobPriority.HIGH,
        queueName: 'analytics-queue',
        delayMs: 5000,
        maxAttempts: 4,
        backoff: {
          type: 'exponential',
          delayMs: 2000,
        },
        tags: ['sync', 'nightly'],
        idempotencyKey: 'idemp-12345',
      };

      const result = createJobSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Daily Sync Job');
        expect(result.data.priority).toBe(2);
        expect(result.data.queueName).toBe('analytics-queue');
      }
    });

    it('should assign robust default values when optional fields are omitted', () => {
      const input = {
        name: 'Basic Job',
        type: JobType.EMAIL_SIMULATION,
        payload: { to: 'user@example.com' },
      };

      const result = createJobSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priority).toBe(JobPriority.NORMAL);
        expect(result.data.queueName).toBe('default');
        expect(result.data.maxAttempts).toBe(3);
        expect(result.data.delayMs).toBe(0);
        expect(result.data.backoff).toEqual({ type: 'exponential', delayMs: 1000 });
        expect(result.data.tags).toEqual([]);
      }
    });

    it('should reject invalid priorities outside 1-10 range', () => {
      const input = {
        name: 'Bad Priority',
        type: 'CUSTOM',
        payload: {},
        priority: 0,
      };

      const result = createJobSchema.safeParse(input);
      expect(result.success).toBe(false);

      const highPriorityResult = createJobSchema.safeParse({ ...input, priority: 11 });
      expect(highPriorityResult.success).toBe(false);
    });

    it('should reject invalid maxAttempts (> 10 or < 0)', () => {
      const negativeResult = createJobSchema.safeParse({
        name: 'Neg Attempts',
        type: 'CUSTOM',
        payload: {},
        maxAttempts: -1,
      });
      expect(negativeResult.success).toBe(false);

      const highResult = createJobSchema.safeParse({
        name: 'High Attempts',
        type: 'CUSTOM',
        payload: {},
        maxAttempts: 15,
      });
      expect(highResult.success).toBe(false);
    });

    it('should reject payloads containing malicious script or eval expressions', () => {
      const scriptPayload = {
        name: 'XSS Attempt',
        type: 'MALICIOUS',
        payload: {
          comment: '<script>alert("pwned")</script>',
        },
      };
      const result = createJobSchema.safeParse(scriptPayload);
      expect(result.success).toBe(false);

      const evalPayload = {
        name: 'Code Exec Attempt',
        type: 'MALICIOUS',
        payload: {
          code: 'eval("process.exit(1)")',
        },
      };
      const evalResult = createJobSchema.safeParse(evalPayload);
      expect(evalResult.success).toBe(false);
    });
  });

  describe('listJobsQuerySchema', () => {
    it('should parse valid query filters and pagination', () => {
      const query = {
        page: '2',
        limit: '50',
        status: JobStatus.PROCESSING,
        priority: '2',
        search: 'welcome',
        sortBy: 'priority',
        order: 'asc',
      };

      const result = listJobsQuerySchema.safeParse(query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
        expect(result.data.status).toBe(JobStatus.PROCESSING);
        expect(result.data.priority).toBe(2);
        expect(result.data.order).toBe('asc');
      }
    });

    it('should reject invalid page or limit values', () => {
      const invalidPage = listJobsQuerySchema.safeParse({ page: '0' });
      expect(invalidPage.success).toBe(false);

      const invalidLimit = listJobsQuerySchema.safeParse({ limit: '500' });
      expect(invalidLimit.success).toBe(false);
    });
  });

  describe('jobIdParamSchema', () => {
    it('should validate non-empty job ID', () => {
      expect(jobIdParamSchema.safeParse({ id: 'job_12345' }).success).toBe(true);
      expect(jobIdParamSchema.safeParse({ id: '' }).success).toBe(false);
    });
  });
});
