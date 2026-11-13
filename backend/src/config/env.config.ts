import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .default('5000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val <= 65535, {
      message: 'PORT must be a valid port number (1-65535)',
    }),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required').default('mongodb://localhost:27017/taskflow'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z
    .string()
    .default('6379')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'REDIS_PORT must be a valid port number',
    }),
  REDIS_PASSWORD: z.string().optional(),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters long')
    .default('taskflow_default_development_secret_key_12345'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters long')
    .default('taskflow_default_development_refresh_key_12345'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
  DEFAULT_QUEUE_NAME: z.string().default('default'),
  WORKER_CONCURRENCY: z
    .string()
    .default('5')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'WORKER_CONCURRENCY must be a positive integer',
    }),
  WORKER_LOCK_DURATION_MS: z
    .string()
    .default('30000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 5000, {
      message: 'WORKER_LOCK_DURATION_MS must be at least 5000ms',
    }),
  WORKER_STALLED_INTERVAL_MS: z
    .string()
    .default('15000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 5000, {
      message: 'WORKER_STALLED_INTERVAL_MS must be at least 5000ms',
    }),
  WORKER_MAX_STALLED_COUNT: z
    .string()
    .default('2')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 1, {
      message: 'WORKER_MAX_STALLED_COUNT must be at least 1',
    }),
}).refine(
  (data) => {
    if (data.NODE_ENV === 'production') {
      return (
        data.JWT_SECRET !== 'taskflow_default_development_secret_key_12345' &&
        data.JWT_SECRET.length >= 32
      );
    }
    return true;
  },
  {
    message: 'In production, JWT_SECRET must be explicitly configured and at least 32 characters long',
    path: ['JWT_SECRET'],
  }
).refine(
  (data) => {
    if (data.NODE_ENV === 'production') {
      return (
        data.JWT_REFRESH_SECRET !== 'taskflow_default_development_refresh_key_12345' &&
        data.JWT_REFRESH_SECRET.length >= 32
      );
    }
    return true;
  },
  {
    message: 'In production, JWT_REFRESH_SECRET must be explicitly configured and at least 32 characters long',
    path: ['JWT_REFRESH_SECRET'],
  }
);

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(customEnv?: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(customEnv || process.env);
  if (!result.success) {
    const errorMessages = result.error.errors
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`\n❌ Environment Variable Validation Failed:\n${errorMessages}\n`);
  }
  return result.data;
}

export const env = validateEnv();
