import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import { enqueue } from '../jobs/queue.js';
import type { CrmEventType } from '../services/svix.js';
import * as copy from '../../shared/copy.js';
import type { Venue } from '../../shared/seed.js';
import { addDays, formatVenueDate, instantAtLocal, isoUtc } from '../../shared/venue-time.js';

/**
 * The events and messages a change produces. Each one is a durable job created
 * in the same transaction as the change, so it takes effect exactly once.
 */

export interface EmailJobPayload {
  to: string;
  subject: string;
  body: string;
}

export async function queueEmail(
  tx: Queryable,
  commissionId: string | null,
  dedupeKey: string,
  email: EmailJobPayload,
): Promise<void> {
  await enqueue(tx, {
    kind: 'email',
    commissionId,
    dedupeKey: `email:${dedupeKey}`,
    payload: { ...email },
  });
}

/** Record a CRM event and queue its delivery through the webhook service. */
export async function queueCrmEvent(
  tx: Queryable,
  options: {
    commissionId: string;
    clientId: string;
    type: CrmEventType;
    data: Record<string, unknown>;
    occurredAt?: Date;
  },
): Promise<string> {
  const eventId = randomUUID();
  const occurredAt = options.occurredAt ?? new Date();
  await tx.query(
    `INSERT INTO crm_events (id, commission_id, client_id, event_type, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      eventId,
      options.commissionId,
      options.clientId,
      options.type,
      occurredAt,
      JSON.stringify({
        eventId,
        type: options.type,
        occurredAt: isoUtc(occurredAt),
        commissionId: options.commissionId,
        data: options.data,
      }),
    ],
  );
  await enqueue(tx, {
    kind: 'webhook',
    commissionId: options.commissionId,
    dedupeKey: `webhook:${eventId}`,
    payload: { eventId },
  });
  return eventId;
}

export type CrewAlertKind = 'slot_confirmed' | 'load_in_tomorrow' | 'placement_changed';

/**
 * Record a crew alert and queue its post. The load-in alert is scheduled for
 * 09:00 venue-local on the day before, and goes at once when that moment has
 * already passed.
 */
export async function queueCrewAlert(
  tx: Queryable,
  options: {
    commissionId: string;
    commissionTitle: string;
    installDayId: string | null;
    kind: CrewAlertKind;
    venue: Venue;
    date: string;
    sendAt?: Date;
  },
): Promise<void> {
  const id = randomUUID();
  const dateLabel = formatVenueDate(options.date);
  const title =
    options.kind === 'slot_confirmed'
      ? copy.slotConfirmedTitle(options.venue.name, dateLabel)
      : options.kind === 'load_in_tomorrow'
        ? copy.loadInTomorrowTitle(options.venue.name, dateLabel)
        : copy.placementChangedTitle(options.commissionTitle);
  const body = copy.crewAlertBody(options.commissionTitle, options.venue.name, dateLabel, id);
  const sendAt = options.sendAt ?? new Date();
  const dedupeKey =
    options.kind === 'placement_changed'
      ? `crew:${options.kind}:${options.commissionId}:${randomUUID()}`
      : `crew:${options.kind}:${options.installDayId ?? options.commissionId}`;

  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO crew_alerts (id, commission_id, install_day_id, kind, title, body, send_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
     RETURNING id`,
    [id, options.commissionId, options.installDayId, options.kind, title, body, sendAt],
  );
  const alertId = inserted.rows[0]?.id;
  if (!alertId) return;
  await enqueue(tx, {
    kind: 'crew_alert',
    commissionId: options.commissionId,
    dedupeKey,
    payload: { alertId },
    runAt: sendAt,
  });
}

/** 09:00 venue-local on the day before the install day. */
export function loadInAlertInstant(installDate: string, venue: Venue): Date {
  return instantAtLocal(addDays(installDate, -1), 9, 0, 0, venue.timeZone);
}
