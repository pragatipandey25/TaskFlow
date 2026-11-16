import { jest } from '@jest/globals';
import { sanitizePayload } from '../../src/core/logging/log-sanitizer.js';

describe('Log & Payload Sanitizer Unit Tests', () => {
  it('should redact sensitive keys such as password, token, apikey, secret', () => {
    const input = {
      user: 'johndoe',
      password: 'superSecretPassword123!',
      apiKey: 'ak_live_839218391283',
      secret_token: 'xyz-999',
      creditCard: '4111222233334444',
      authorization: 'Bearer sensitive-token-here',
      cookie: 'session_id=12345',
      normalField: 'all good here',
    };

    const sanitized = sanitizePayload(input);

    expect(sanitized.user).toBe('johndoe');
    expect(sanitized.normalField).toBe('all good here');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.apiKey).toBe('[REDACTED]');
    expect(sanitized.secret_token).toBe('[REDACTED]');
    expect(sanitized.creditCard).toBe('[REDACTED]');
    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized.cookie).toBe('[REDACTED]');
  });

  it('should recursively sanitize deeply nested objects and arrays', () => {
    const complex = {
      service: 'payment-gateway',
      nested: {
        api_key: 'top-secret',
        metadata: {
          token: 'token-abc',
          count: 5,
        },
        items: [
          { name: 'item1', auth: 'basic-auth-cred' },
          { name: 'item2', publicInfo: 'safe' },
        ],
      },
    };

    const sanitized = sanitizePayload(complex);

    expect(sanitized.service).toBe('payment-gateway');
    expect(sanitized.nested.api_key).toBe('[REDACTED]');
    expect(sanitized.nested.metadata.token).toBe('[REDACTED]');
    expect(sanitized.nested.metadata.count).toBe(5);
    expect(sanitized.nested.items[0].auth).toBe('[REDACTED]');
    expect(sanitized.nested.items[0].name).toBe('item1');
    expect(sanitized.nested.items[1].publicInfo).toBe('safe');
  });

  it('should redact standalone JWT string values', () => {
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    const result = sanitizePayload(fakeJwt);
    expect(result).toBe('[REDACTED_JWT]');
  });

  it('should preserve null, undefined, numbers, and booleans unharmed', () => {
    expect(sanitizePayload(null)).toBeNull();
    expect(sanitizePayload(undefined)).toBeUndefined();
    expect(sanitizePayload(42)).toBe(42);
    expect(sanitizePayload(true)).toBe(true);
    expect(sanitizePayload('simple string')).toBe('simple string');
  });
});
