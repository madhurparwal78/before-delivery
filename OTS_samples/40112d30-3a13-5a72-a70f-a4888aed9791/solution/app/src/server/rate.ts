import { rateLimited } from './errors.ts';
import { attempt } from './valkey.ts';
import { clockHourKey, clockMinuteKey } from './time.ts';
import { config } from './config.ts';

// Rate-limit counters live in Valkey, keyed by the server clock; they pause while Valkey is down (brief: Services).

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3_600;

async function hit(key: string, limit: number, seconds: number): Promise<void> {
  const count = await attempt(async (client) => {
    const n = await client.incr(key);
    if (n === 1) await client.expire(key, seconds);
    return n;
  });
  if (count !== null && count > limit) throw rateLimited();
}

export const hitSubmitLimit = (ip: string): Promise<void> =>
  hit(`nf:rl:submit:${ip}:${clockMinuteKey()}`, config.submitPerMinute, MINUTE_SECONDS);

export const hitResumeEmailLimit = (ip: string): Promise<void> =>
  hit(`nf:rl:resume:${ip}:${clockHourKey()}`, config.resumeEmailPerHour, HOUR_SECONDS);
