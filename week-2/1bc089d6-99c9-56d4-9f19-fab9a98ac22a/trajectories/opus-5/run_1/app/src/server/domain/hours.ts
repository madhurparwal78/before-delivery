import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { clientQuery, query, transaction } from '../db.js';
import { ApiError } from '../errors.js';
import { startsAtLocal, type Plan, type PlanRitual, type ReminderState } from '../../shared/plan.js';
import type { PlanValues } from './planRules.js';
import { nextReminderAt, processHour, toHourRecord } from './reminders.js';

export interface HourRecord {
  id: string;
  email: string;
  bedtime: string;
  time_zone: string;
  rituals: PlanRitual[];
  note: string;
  reminders: ReminderState;
  version: number;
  confirmedAt: Date;
  remindersStartAt: Date;
}

export interface DraftRecord {
  id: string;
  email: string;
  bedtime: string;
  time_zone: string;
  rituals: PlanRitual[];
  note: string;
}

const HOUR_COLUMNS =
  'id, email, bedtime, time_zone, rituals, note, reminders, version, confirmed_at, reminders_start_at';

export async function findHour(email: string): Promise<HourRecord | null> {
  const result = await query(`select ${HOUR_COLUMNS} from hours where email = $1`, [email]);
  const row = result.rows[0];
  return row ? toHourRecord(row as never) : null;
}

export async function hasDraft(email: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>('select exists (select 1 from drafts where email = $1)', [email]);
  return result.rows[0]!.exists;
}

export async function shareToken(email: string): Promise<string | null> {
  const result = await query<{ token: string }>('select token from share_links where email = $1', [email]);
  return result.rows[0]?.token ?? null;
}

export const totalMinutes = (rituals: PlanRitual[]): number =>
  rituals.reduce((sum, ritual) => sum + ritual.minutes, 0);

/** The published plan shape, with its derived values brought up to date. */
export async function toPlan(hour: HourRecord, at: Date): Promise<Plan> {
  await processHour(hour, at);
  const [token, next] = await Promise.all([shareToken(hour.email), nextReminderAt(hour, at)]);
  return {
    id: hour.id,
    email: hour.email,
    bedtime: hour.bedtime,
    time_zone: hour.time_zone,
    rituals: hour.rituals,
    total_minutes: totalMinutes(hour.rituals),
    note: hour.note,
    reminders: hour.reminders,
    version: hour.version,
    starts_at_local: startsAtLocal(hour.bedtime),
    next_reminder_at: next ? next.toISOString() : null,
    share_url: token ? `/p/${token}` : null,
  };
}

export async function createDraft(
  client: PoolClient,
  values: Required<Pick<PlanValues, 'email' | 'bedtime' | 'timeZone' | 'rituals' | 'note'>>,
  at: Date,
): Promise<DraftRecord> {
  const id = randomUUID();
  await clientQuery(
    client,
    `insert into drafts (id, email, bedtime, time_zone, rituals, note, created_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [id, values.email, values.bedtime, values.timeZone, JSON.stringify(values.rituals), values.note, at],
  );
  return {
    id,
    email: values.email,
    bedtime: values.bedtime,
    time_zone: values.timeZone,
    rituals: values.rituals,
    note: values.note,
  };
}

/**
 * Turns a draft into the address's confirmed hour with reminders on. An address that
 * already keeps an hour keeps its id and share link, and its version goes up by one.
 */
export async function confirmDraft(draftId: string, at: Date): Promise<void> {
  await transaction(async (client) => {
    const draft = await clientQuery<DraftRecord & { time_zone: string }>(
      client,
      'select id, email, bedtime, time_zone, rituals, note from drafts where id = $1',
      [draftId],
    );
    const row = draft.rows[0];
    if (!row) return;
    await clientQuery(
      client,
      `insert into hours (id, email, bedtime, time_zone, rituals, note, reminders, version, confirmed_at, reminders_start_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, 'on', 1, $7, $7)
       on conflict (email) do update
         set bedtime = excluded.bedtime,
             time_zone = excluded.time_zone,
             rituals = excluded.rituals,
             note = excluded.note,
             reminders = 'on',
             version = hours.version + 1,
             reminders_start_at = excluded.reminders_start_at`,
      [randomUUID(), row.email, row.bedtime, row.time_zone, JSON.stringify(row.rituals), row.note, at],
    );
  });
}

/** Lays the supplied keys over the stored hour and raises its version by one. */
export async function patchHour(hour: HourRecord, values: PlanValues, at: Date): Promise<HourRecord> {
  const bedtime = values.bedtime ?? hour.bedtime;
  const timeZone = values.timeZone ?? hour.time_zone;
  const rituals = values.rituals ?? hour.rituals;
  const note = values.note ?? hour.note;
  const reminders = values.reminders ?? hour.reminders;
  const resumed = reminders === 'on' && hour.reminders === 'paused';
  const rescheduled = bedtime !== hour.bedtime || timeZone !== hour.time_zone;
  const remindersStartAt = resumed || rescheduled ? at : hour.remindersStartAt;
  const result = await query(
    `update hours
        set bedtime = $3, time_zone = $4, rituals = $5::jsonb, note = $6, reminders = $7,
            reminders_start_at = $8, version = version + 1
      where id = $1 and version = $2
      returning ${HOUR_COLUMNS}`,
    [hour.id, hour.version, bedtime, timeZone, JSON.stringify(rituals), note, reminders, remindersStartAt],
  );
  const row = result.rows[0];
  if (!row) {
    const current = await findHour(hour.email);
    throw new ApiError('version_conflict', { current: current ? await toPlan(current, at) : undefined });
  }
  return toHourRecord(row as never);
}

/** Removes the hour, drafts, links, sessions, share link, unsent emails and reminder records. */
export async function deleteEverything(email: string): Promise<void> {
  await transaction(async (client) => {
    await clientQuery(client, 'delete from sessions where email = $1', [email]);
    await clientQuery(client, 'delete from links where email = $1', [email]);
    await clientQuery(client, 'delete from drafts where email = $1', [email]);
    await clientQuery(client, 'delete from share_links where email = $1', [email]);
    await clientQuery(client, 'delete from outbox where recipient = $1 and sent_at is null', [email]);
    await clientQuery(client, 'delete from hours where email = $1', [email]);
  });
}

export async function liveCount(): Promise<number> {
  const result = await query<{ keeping: string }>("select count(*)::text as keeping from hours where reminders = 'on'");
  return Number(result.rows[0]!.keeping);
}
