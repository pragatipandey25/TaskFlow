import { z } from 'zod';

export const createQueueSchema = z.object({
  name: z
    .string({ required_error: 'Queue name is required' })
    .min(1, 'Queue name cannot be empty')
    .max(100, 'Queue name must be under 100 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Queue name must be alphanumeric with underscores or hyphens'),
  description: z.string().max(250, 'Description must be under 250 characters').optional(),
  defaultPriority: z.number().int().min(1).max(10).default(5),
  maxConcurrency: z.number().int().min(1).max(100).default(10),
  rateLimit: z
    .object({
      maxJobs: z.number().int().positive().default(1000),
      durationMs: z.number().int().positive().default(1000),
    })
    .default({ maxJobs: 1000, durationMs: 1000 }),
});

export type CreateQueueDto = z.infer<typeof createQueueSchema>;
