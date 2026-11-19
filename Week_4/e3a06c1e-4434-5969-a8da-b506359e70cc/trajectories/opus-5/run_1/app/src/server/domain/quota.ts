import type { Quota } from '../../shared/types.js';

export interface Period {
  readonly start: Date;
  readonly resets: Date;
}

/** The quota period is the current calendar month in UTC, by the server's clock. */
export const currentPeriod = (now: Date): Period => ({
  start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  resets: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
});

export const monthKey = (now: Date): string =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

/** Open sessions accrue received audio milliseconds x channels / 1000, rounded down. */
export const openSessionSeconds = (audioMs: number, channels: number): number =>
  Math.floor((audioMs * channels) / 1000);

export const buildQuota = (limitMinutes: number, usedSeconds: number, period: Period, now: Date): Quota => ({
  limit_minutes: limitMinutes,
  used_seconds: usedSeconds,
  period_start: period.start.toISOString(),
  resets_at: period.resets.toISOString(),
  exhausted: usedSeconds >= limitMinutes * 60,
  server_time: now.toISOString(),
});
