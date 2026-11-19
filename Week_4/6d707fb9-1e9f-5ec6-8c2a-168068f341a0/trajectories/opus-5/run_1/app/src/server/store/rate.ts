import { FILE_RATE_LIMIT, REQUEST_RATE_LIMIT, config } from '../config';
import { query } from '../db/pool';
import { copy } from '../domain/copy';
import { LISBON, localTime } from '../domain/time';
import { newId } from '../ids';
import { problem } from '../http/problem';

type Kind = 'request' | 'file';

const SETTINGS: Record<Kind, { limit: number; window: () => number; message: (time: string) => string }> = {
  request: {
    limit: REQUEST_RATE_LIMIT,
    window: () => config.requestRateWindowSeconds,
    message: copy.tooManyRequests,
  },
  file: {
    limit: FILE_RATE_LIMIT,
    window: () => config.fileRateWindowSeconds,
    message: copy.tooManyDownloads,
  },
};

/** The limit is keyed on the desk, whichever session or network address sends. */
export async function checkRate(kind: Kind, deskId: string, now: number): Promise<void> {
  const setting = SETTINGS[kind];
  const since = now - setting.window();
  const events = await query<{ at: string }>(
    'select at from rate_events where assessor_id = $1 and kind = $2 and at > $3 order by at',
    [deskId, kind, since],
  );
  if (events.length < setting.limit) return;
  const oldest = Number((events[0] as { at: string }).at);
  const retryAfter = Math.max(1, oldest + setting.window() - now);
  throw problem.rateLimited(retryAfter, setting.message(localTime(now + retryAfter, LISBON)));
}

export async function recordRateEvent(kind: Kind, deskId: string, now: number): Promise<void> {
  await query('insert into rate_events (id, assessor_id, kind, at) values ($1,$2,$3,$4)', [
    newId(),
    deskId,
    kind,
    now,
  ]);
}
