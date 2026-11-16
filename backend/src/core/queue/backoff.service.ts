import { BackoffConfig } from '@taskflow/shared';

export interface ExtendedBackoffConfig extends BackoffConfig {
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
}

export class BackoffService {
  private static instance: BackoffService;

  // Defaults
  public static readonly DEFAULT_BASE_DELAY_MS = 1000;
  public static readonly DEFAULT_MAX_DELAY_MS = 300000; // 5 minutes
  public static readonly DEFAULT_FACTOR = 2;

  private constructor() {}

  public static getInstance(): BackoffService {
    if (!BackoffService.instance) {
      BackoffService.instance = new BackoffService();
    }
    return BackoffService.instance;
  }

  /**
   * Computes the retry delay in milliseconds using exponential backoff with full randomized jitter.
   *
   * Formula (Full Jitter):
   *   Backoff(attempt) = min(maxDelay, baseDelay * factor^(attempt - 1))
   *   DelayWithJitter = Math.floor(Math.random() * Backoff(attempt))
   *
   * @param attemptNumber 1-based attempt index (1 = first retry, 2 = second retry, etc.)
   * @param config Optional backoff configuration overrides
   */
  public calculateBackoff(
    attemptNumber: number,
    config?: Partial<ExtendedBackoffConfig>
  ): number {
    const attempt = Math.max(1, attemptNumber);
    const baseDelay = config?.delayMs && config.delayMs > 0
      ? config.delayMs
      : BackoffService.DEFAULT_BASE_DELAY_MS;
    const maxDelay = config?.maxDelayMs && config.maxDelayMs > 0
      ? config.maxDelayMs
      : BackoffService.DEFAULT_MAX_DELAY_MS;
    const factor = config?.factor && config.factor > 0
      ? config.factor
      : BackoffService.DEFAULT_FACTOR;

    const backoffType = config?.type || 'exponential';

    // 1. Fixed delay strategy
    if (backoffType === 'fixed') {
      const fixedDelay = Math.min(baseDelay, maxDelay);
      if (config?.jitter) {
        return Math.floor(Math.random() * fixedDelay);
      }
      return fixedDelay;
    }

    // 2. Exponential delay calculation: baseDelay * factor^(attempt - 1)
    // Guard against potential integer overflow for large attempt numbers
    const exponent = Math.min(attempt - 1, 30);
    const calculatedBackoff = Math.min(maxDelay, baseDelay * Math.pow(factor, exponent));

    // 3. Full Jitter: randomize delay between 0 and calculatedBackoff
    // Full jitter spreads retry attempts evenly across the window to prevent thundering herds
    const applyJitter = config?.jitter !== false; // enabled by default for exponential
    if (applyJitter) {
      const jittered = Math.floor(Math.random() * calculatedBackoff);
      // Ensure at least a minimal 50ms delay for scheduling
      return Math.max(50, jittered);
    }

    return Math.floor(calculatedBackoff);
  }

  /**
   * Deterministic calculation (without jitter) for testing and predictable analysis.
   */
  public calculateDeterministicBackoff(
    attemptNumber: number,
    config?: Partial<ExtendedBackoffConfig>
  ): number {
    return this.calculateBackoff(attemptNumber, { ...config, jitter: false });
  }
}

export const backoffService = BackoffService.getInstance();
