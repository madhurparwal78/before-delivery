import { config } from '../config';
import { MemberRow, findMember } from '../data';
import { newId, query } from '../db';
import { rateLimited } from '../http/errors';
import { RequestContext } from '../http/kernel';
import { copy } from '../shared/copy';
import { TimeZoneId, localTime } from '../shared/time';

export type RateKind = 'message' | 'file';

const LIMITS: Record<RateKind, { allowed: number; windowSeconds: () => number }> = {
  message: { allowed: 10, windowSeconds: () => config.messageRateWindowSeconds },
  file: { allowed: 5, windowSeconds: () => config.fileRateWindowSeconds },
};

/** The retry instant in the member's local time, rounded up to a whole minute. */
function retryTime(instant: Date, zone: TimeZoneId): string {
  const seconds = Math.floor(instant.getTime() / 1000);
  const rounded = new Date((seconds % 60 === 0 ? seconds : seconds + (60 - (seconds % 60))) * 1000);
  return localTime(rounded, zone);
}

export async function enforceRateLimit(ctx: RequestContext, kind: RateKind): Promise<void> {
  const who = ctx.session?.person;
  if (!who || who.role !== 'member') return;
  const member = await findMember(who.id);
  if (!member) return;
  const limit = LIMITS[kind];
  const windowSeconds = limit.windowSeconds();
  const rows = await query<{ at: Date }>(
    `select at from rate_events
     where member_id = $1 and kind = $2 and at > now() - ($3 || ' seconds')::interval
     order by at`,
    [member.id, kind, String(windowSeconds)],
  );
  if (rows.length < limit.allowed) return;
  const oldest = rows[0] as { at: Date };
  const retryAt = new Date(oldest.at.getTime() + windowSeconds * 1000);
  const retryAfter = Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000));
  const message =
    kind === 'message'
      ? copy.messageLimit(retryTime(retryAt, member.time_zone), member.time_zone)
      : copy.downloadLimit(retryTime(retryAt, member.time_zone), member.time_zone);
  throw rateLimited(message, retryAfter);
}

export async function recordRateEvent(member: MemberRow, kind: RateKind): Promise<void> {
  await query('insert into rate_events (id, member_id, kind) values ($1, $2, $3)', [
    newId(),
    member.id,
    kind,
  ]);
}
