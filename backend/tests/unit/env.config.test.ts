import { validateEnv } from '../../src/config/env.config.js';

describe('Environment Variable Validation (Zod)', () => {
  const validEnv = {
    NODE_ENV: 'test',
    PORT: '5001',
    MONGO_URI: 'mongodb://localhost:27017/taskflow-test',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    JWT_SECRET: 'test_secret_key_at_least_16_characters',
    JWT_REFRESH_SECRET: 'test_refresh_key_at_least_16_characters',
    CORS_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'info',
  };

  it('should successfully parse valid environment variables', () => {
    const config = validateEnv(validEnv);
    expect(config.PORT).toBe(5001);
    expect(config.NODE_ENV).toBe('test');
    expect(config.REDIS_PORT).toBe(6379);
    expect(config.MONGO_URI).toBe('mongodb://localhost:27017/taskflow-test');
  });

  it('should use default values for optional environment variables', () => {
    const minimalEnv = {
      MONGO_URI: 'mongodb://localhost:27017/taskflow',
    };
    const config = validateEnv(minimalEnv);
    expect(config.PORT).toBe(5000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.REDIS_HOST).toBe('localhost');
  });

  it('should throw an error if PORT is invalid', () => {
    const invalidEnv = {
      ...validEnv,
      PORT: 'invalid_port',
    };
    expect(() => validateEnv(invalidEnv)).toThrow('Environment Variable Validation Failed');
  });

  it('should throw an error if JWT_SECRET is too short (< 16 chars)', () => {
    const invalidEnv = {
      ...validEnv,
      JWT_SECRET: 'short',
    };
    expect(() => validateEnv(invalidEnv)).toThrow('JWT_SECRET must be at least 16 characters long');
  });
});
