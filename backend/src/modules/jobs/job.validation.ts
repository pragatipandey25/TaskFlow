import { z } from 'zod';
import { JobStatus, JobPriority } from '@taskflow/shared';

// Disallow executable code strings or function declarations in payload
function isSafePayloadValue(val: unknown): boolean {
  if (typeof val === 'function') return false;
  if (typeof val === 'string') {
    const dangerousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /eval\s*\(/gi,
      /Function\s*\(/gi,
    ];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(val)) return false;
    }
  }
  if (Array.isArray(val)) {
    return val.every(isSafePayloadValue);
  }
  if (val !== null && typeof val === 'object') {
    return Object.values(val as Record<string, unknown>).every(isSafePayloadValue);
  }
  return true;
}

export const createJobSchema = z.object({
  name: z
    .string({ required_error: 'Job name is required' })
    .trim()
    .min(1, 'Job name cannot be empty')
    .max(100, 'Job name cannot exceed 100 characters'),
  type: z
    .string({ required_error: 'Job type is required' })
    .trim()
    .min(1, 'Job type cannot be empty')
    .max(50, 'Job type cannot exceed 50 characters'),
  payload: z
    .record(z.unknown(), { required_error: 'Payload is required' })
    .refine((obj) => Object.keys(obj).length >= 0, {
      message: 'Payload must be an object',
    })
    .refine(isSafePayloadValue, {
      message: 'Payload contains illegal or potentially malicious executable patterns',
    }),
  priority: z
    .number()
    .int('Priority must be an integer')
    .min(1, 'Priority must be between 1 (highest) and 10 (lowest)')
    .max(10, 'Priority must be between 1 (highest) and 10 (lowest)')
    .default(JobPriority.NORMAL),
  queueName: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Queue name must be alphanumeric with dashes or underscores')
    .default('default'),
  delayMs: z
    .number()
    .int('Delay must be an integer in milliseconds')
    .min(0, 'Delay cannot be negative')
    .default(0),
  maxAttempts: z
    .number()
    .int('Max attempts must be an integer')
    .min(0, 'Max attempts cannot be negative')
    .max(10, 'Max attempts cannot exceed 10')
    .default(3),
  backoff: z
    .object({
      type: z.enum(['exponential', 'fixed']).default('exponential'),
      delayMs: z.number().int().min(100).max(300000).default(1000),
    })
    .default({ type: 'exponential', delayMs: 1000 }),
  tags: z.array(z.string().trim().max(30)).max(10).default([]),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .optional(),
});

export const listJobsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .refine((val) => !isNaN(val) && val >= 1, { message: 'Page must be a positive integer' }),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .refine((val) => !isNaN(val) && val >= 1 && val <= 100, {
      message: 'Limit must be between 1 and 100',
    }),
  status: z.nativeEnum(JobStatus).optional(),
  queueName: z.string().optional(),
  type: z.string().optional(),
  priority: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .refine((val) => val === undefined || (val >= 1 && val <= 10), {
      message: 'Priority must be between 1 and 10',
    }),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'status', 'name']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const jobIdParamSchema = z.object({
  id: z
    .string({ required_error: 'Job ID parameter is required' })
    .trim()
    .min(1, 'Job ID cannot be empty'),
});

export const cancelJobSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export type CreateJobDTO = z.infer<typeof createJobSchema>;
export type ListJobsQueryDTO = z.infer<typeof listJobsQuerySchema>;
