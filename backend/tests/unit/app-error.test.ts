import {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  DatabaseConnectionError,
} from '../../src/core/errors/app-error.js';

describe('AppError Domain Hierarchy', () => {
  it('should instantiate AppError with default properties', () => {
    const error = new AppError('General server failure');
    expect(error.message).toBe('General server failure');
    expect(error.statusCode).toBe(500);
    expect(error.errorCode).toBe('INTERNAL_SERVER_ERROR');
    expect(error.isOperational).toBe(true);
  });

  it('should instantiate ValidationError with 400 status', () => {
    const error = new ValidationError('Invalid email format', [
      { field: 'email', issue: 'Must be valid' },
    ]);
    expect(error.statusCode).toBe(400);
    expect(error.errorCode).toBe('VALIDATION_ERROR');
    expect(error.details).toHaveLength(1);
    expect(error.details?.[0].field).toBe('email');
  });

  it('should instantiate NotFoundError with 404 status', () => {
    const error = new NotFoundError('Job not found');
    expect(error.statusCode).toBe(404);
    expect(error.errorCode).toBe('NOT_FOUND');
  });

  it('should instantiate UnauthorizedError with 401 status', () => {
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe('UNAUTHORIZED');
  });

  it('should instantiate ForbiddenError with 403 status', () => {
    const error = new ForbiddenError();
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('FORBIDDEN');
  });

  it('should instantiate ConflictError with 409 status', () => {
    const error = new ConflictError('Idempotency key collision');
    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe('CONFLICT');
  });

  it('should instantiate DatabaseConnectionError with 503 status', () => {
    const error = new DatabaseConnectionError();
    expect(error.statusCode).toBe(503);
    expect(error.errorCode).toBe('DATABASE_UNAVAILABLE');
  });
});
