/**
 * Utility to sanitize logs and payload objects by redacting confidential secrets,
 * passwords, JWT tokens, and API credentials.
 */

const SENSITIVE_KEY_PATTERNS = [
  /passw(or)?d/i,
  /secret/i,
  /token/i,
  /auth(orization)?/i,
  /bearer/i,
  /apikey/i,
  /api[-_]?key/i,
  /credit[-_]?card/i,
  /cookie/i,
];

export function sanitizePayload<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    // Redact JWT strings if found in text
    if (/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(input) && input.length > 30) {
      return '[REDACTED_JWT]' as unknown as T;
    }
    // Redact inline secret assignments like password=... or token=...
    const sanitizedStr = input.replace(
      /(passw(?:or)?d|secret|token|api[-_]?key)=([^\s&,;]+)/gi,
      '$1=[REDACTED]'
    );
    return sanitizedStr as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizePayload(item)) as unknown as T;
  }

  if (typeof input === 'object') {
    const sanitizedObj: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitiveKey) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = sanitizePayload(val);
      }
    }

    return sanitizedObj as T;
  }

  return input;
}
