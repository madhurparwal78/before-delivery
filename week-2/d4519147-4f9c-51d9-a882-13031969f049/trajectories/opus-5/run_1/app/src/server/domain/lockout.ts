import { SIGNIN_IP_THRESHOLD, SIGNIN_PAIR_THRESHOLD, config } from '../config';
import { query } from '../db';

export interface LockState {
  locked: boolean;
  retryAfterSeconds: number;
}

interface FailureRow {
  at: Date;
}

/**
 * The sign-in lockout: five failures for one email and IP pair, or twenty from
 * one IP, within the window, lock for the lock time counted from that failure.
 */
async function lockUntil(where: string, values: unknown[], threshold: number): Promise<number | null> {
  const rows = await query<FailureRow>(
    `select at from signin_failures where ${where} order by at desc limit ${threshold}`,
    values,
  );
  if (rows.length < threshold) return null;
  const newest = rows[0];
  const oldest = rows[threshold - 1];
  if (!newest || !oldest) return null;
  if (newest.at.getTime() - oldest.at.getTime() > config.signinWindowSeconds * 1000) return null;
  return newest.at.getTime() + config.signinLockSeconds * 1000;
}

export async function lockState(email: string, ip: string): Promise<LockState> {
  const pair = await lockUntil('email = $1 and ip = $2', [email.toLowerCase(), ip], SIGNIN_PAIR_THRESHOLD);
  const perIp = await lockUntil('ip = $1', [ip], SIGNIN_IP_THRESHOLD);
  const now = Date.now();
  const deadlines = [pair, perIp].filter((value): value is number => value !== null && value > now);
  if (deadlines.length === 0) return { locked: false, retryAfterSeconds: 0 };
  const longest = Math.max(...deadlines);
  return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((longest - now) / 1000)) };
}

export interface FailureOutcome {
  lockStarted: boolean;
}

export async function recordFailure(email: string, ip: string): Promise<FailureOutcome> {
  const before = await lockState(email, ip);
  await query('insert into signin_failures (email, ip) values ($1, $2)', [email.toLowerCase(), ip]);
  const after = await lockState(email, ip);
  const keepSeconds = (config.signinWindowSeconds + config.signinLockSeconds) * 2;
  await query(`delete from signin_failures where at < now() - interval '1 second' * $1`, [keepSeconds]);
  return { lockStarted: !before.locked && after.locked };
}

export async function clearFailures(email: string, ip: string): Promise<void> {
  await query('delete from signin_failures where email = $1 and ip = $2', [email.toLowerCase(), ip]);
}
