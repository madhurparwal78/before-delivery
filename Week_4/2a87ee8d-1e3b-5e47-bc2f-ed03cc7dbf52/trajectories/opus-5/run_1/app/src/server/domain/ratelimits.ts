import { config } from '../config.js';

export type RateLimitClass = 'signin' | 'join' | 'board_write' | 'upload' | 'presence';

export interface RateLimitRule {
  readonly limit: number;
  /** Fixed window length in seconds. */
  readonly windowSeconds: number;
}

/** The one place each rate-limit class is defined. */
export function rateLimitRule(limitClass: RateLimitClass): RateLimitRule {
  switch (limitClass) {
    case 'signin':
      return { limit: 5, windowSeconds: config.signinWindowSeconds };
    case 'join':
      return { limit: 30, windowSeconds: 60 };
    case 'board_write':
      return { limit: 120, windowSeconds: 10 };
    case 'upload':
      return { limit: 10, windowSeconds: 60 };
    case 'presence':
      return { limit: 40, windowSeconds: 2 };
  }
}

/** Fixed windows aligned to multiples of the window length since the Unix epoch. */
export function windowStartSeconds(nowMs: number, windowSeconds: number): number {
  const nowSeconds = Math.floor(nowMs / 1000);
  return nowSeconds - (nowSeconds % windowSeconds);
}

/** Whole seconds, rounded up, until the current window ends. */
export function resetSeconds(rule: RateLimitRule, nowMs: number): number {
  const start = windowStartSeconds(nowMs, rule.windowSeconds);
  return Math.max(0, Math.ceil(start + rule.windowSeconds - nowMs / 1000));
}

export function rateLimitHeaders(
  rule: RateLimitRule,
  count: number,
  nowMs: number,
): Record<string, string> {
  return {
    'RateLimit-Limit': String(rule.limit),
    'RateLimit-Remaining': String(Math.max(0, rule.limit - count)),
    'RateLimit-Reset': String(resetSeconds(rule, nowMs)),
  };
}
