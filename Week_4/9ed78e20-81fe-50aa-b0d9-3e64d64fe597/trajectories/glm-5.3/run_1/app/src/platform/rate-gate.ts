import type { DbClient } from './db.js';
import { enforceRateLimit, type BucketName, type RateResult } from './ratelimit.js';
import { config } from '../config.js';
import { errors } from './errors.js';

export async function rateLimitAndHeaders(
  client: DbClient,
  bucket: BucketName,
  key: string,
  counted: boolean,
): Promise<{ result: RateResult | null; headers: Record<string, string> }> {
  if (!counted) return { result: null, headers: {} };
  const limits: Record<BucketName, number> = {
    public: config.rateLimit.public,
    candidate: config.rateLimit.candidate,
    signin: config.rateLimit.signin,
    console: config.rateLimit.consoleWrites,
  };
  const result = await enforceRateLimit(client, bucket, key, limits[bucket]);
  const headers = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.reset),
  };
  if (!result.allowed) {
    throw errors.rateLimited(result.reset);
  }
  return { result, headers };
}

export function rateHeadersFrom(result: RateResult): Record<string, string> {
  return {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.reset),
  };
}
