import { parseRfc3339WithOffset } from '../../shared/businessTime.ts';
import { type Queryable } from '../db.ts';
import { latestSeq } from '../domain/snapshot.ts';
import type { Ctx } from './context.ts';
import { errors } from './errors.ts';

export interface AsOf {
  seq: number;
  at: string | null;
  /** True when the caller sent as_of_seq or as_of_time. */
  explicit: boolean;
}

async function atOfSeq(client: Queryable, seq: number): Promise<string | null> {
  if (seq === 0) return null;
  const result = await client.query<{ at: string }>('SELECT at FROM audit_log WHERE seq = $1', [seq]);
  return result.rows[0]?.at ?? null;
}

/** Resolves as_of_seq or as_of_time, or the latest seq when neither is sent. */
export async function resolveAsOf(client: Queryable, ctx: Ctx): Promise<AsOf> {
  const rawSeq = ctx.queryParam('as_of_seq');
  const rawTime = ctx.queryParam('as_of_time');
  if (rawSeq !== null && rawTime !== null) {
    throw errors.validation({ as_of_time: 'Send as_of_seq or as_of_time, not both.' });
  }
  const latest = await latestSeq(client);
  if (rawSeq !== null) {
    const seq = Number(rawSeq);
    if (!/^\d+$/.test(rawSeq) || !Number.isSafeInteger(seq) || seq > latest) {
      throw errors.validation({ as_of_seq: 'Use an audit seq from 0 to the latest seq.' });
    }
    return { seq, at: await atOfSeq(client, seq), explicit: true };
  }
  if (rawTime !== null) {
    const instant = parseRfc3339WithOffset(rawTime);
    if (instant === null) {
      throw errors.validation({ as_of_time: 'Use an RFC 3339 time with an offset.' });
    }
    const result = await client.query<{ seq: string | null }>(
      'SELECT max(seq) AS seq FROM audit_log WHERE at <= $1',
      [new Date(instant).toISOString()],
    );
    const seq = Number(result.rows[0]?.seq ?? 0);
    return { seq, at: await atOfSeq(client, seq), explicit: true };
  }
  return { seq: latest, at: null, explicit: false };
}

export function withAsOf<T extends object>(asOf: AsOf, body: T): T | (T & { as_of_seq: number; as_of_at: string | null }) {
  if (!asOf.explicit) return body;
  return { as_of_seq: asOf.seq, as_of_at: asOf.at, ...body };
}
