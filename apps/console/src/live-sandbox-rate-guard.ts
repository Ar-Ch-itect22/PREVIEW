const ONE_HOUR_MS = 60 * 60 * 1_000;
const DEFAULT_CLIENT_LIMIT = 3;
const DEFAULT_GLOBAL_LIMIT = 24;

export interface LiveSandboxRateLimitConfig {
  readonly clientLimit: number;
  readonly globalLimit: number;
  readonly windowMs: number;
}

export type LiveSandboxRateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

interface LiveSandboxRateGuardOptions extends LiveSandboxRateLimitConfig {
  readonly now?: () => number;
}

export class LiveSandboxRateGuard {
  public readonly config: LiveSandboxRateLimitConfig;
  readonly #clientAttempts = new Map<string, number[]>();
  readonly #globalAttempts: number[] = [];
  readonly #now: () => number;

  public constructor(options: LiveSandboxRateGuardOptions) {
    assertPositiveInteger(options.clientLimit, 'clientLimit');
    assertPositiveInteger(options.globalLimit, 'globalLimit');
    assertPositiveInteger(options.windowMs, 'windowMs');
    if (options.clientLimit > options.globalLimit) {
      throw new TypeError('Live Sandbox client limit cannot exceed the global limit');
    }
    this.config = Object.freeze({
      clientLimit: options.clientLimit,
      globalLimit: options.globalLimit,
      windowMs: options.windowMs,
    });
    this.#now = options.now ?? Date.now;
  }

  public tryAcquire(clientId: string): LiveSandboxRateLimitResult {
    const now = this.#now();
    const cutoff = now - this.config.windowMs;
    prune(this.#globalAttempts, cutoff);
    const clientAttempts = this.#clientAttempts.get(clientId) ?? [];
    prune(clientAttempts, cutoff);
    if (clientAttempts.length === 0) this.#clientAttempts.delete(clientId);

    const globalRetry = retryAfterMilliseconds(
      this.#globalAttempts,
      this.config.globalLimit,
      now,
      this.config.windowMs,
    );
    const clientRetry = retryAfterMilliseconds(
      clientAttempts,
      this.config.clientLimit,
      now,
      this.config.windowMs,
    );
    const retryAfterMs = Math.max(globalRetry, clientRetry);
    if (retryAfterMs > 0) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)) };
    }

    this.#globalAttempts.push(now);
    clientAttempts.push(now);
    this.#clientAttempts.set(clientId, clientAttempts);
    return { allowed: true };
  }
}

export function loadLiveSandboxRateLimitConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LiveSandboxRateLimitConfig {
  return Object.freeze({
    clientLimit: parseLimit(
      environment.PREVIEW_LIVE_SANDBOX_CLIENT_LIMIT,
      DEFAULT_CLIENT_LIMIT,
      'PREVIEW_LIVE_SANDBOX_CLIENT_LIMIT',
    ),
    globalLimit: parseLimit(
      environment.PREVIEW_LIVE_SANDBOX_GLOBAL_LIMIT,
      DEFAULT_GLOBAL_LIMIT,
      'PREVIEW_LIVE_SANDBOX_GLOBAL_LIMIT',
    ),
    windowMs: ONE_HOUR_MS,
  });
}

function parseLimit(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  if (!/^\d+$/u.test(value)) throw new TypeError(`${name} must be a positive integer`);
  const parsed = Number(value);
  assertPositiveInteger(parsed, name);
  return parsed;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function prune(attempts: number[], cutoff: number): void {
  while (attempts[0] !== undefined && attempts[0] <= cutoff) attempts.shift();
}

function retryAfterMilliseconds(
  attempts: readonly number[],
  limit: number,
  now: number,
  windowMs: number,
): number {
  if (attempts.length < limit) return 0;
  const blockingAttempt = attempts[attempts.length - limit];
  return blockingAttempt === undefined ? 0 : blockingAttempt + windowMs - now;
}
