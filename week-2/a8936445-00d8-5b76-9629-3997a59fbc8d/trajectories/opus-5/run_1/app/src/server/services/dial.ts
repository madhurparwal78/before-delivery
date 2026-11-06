import { errors } from '../http/errors.js';
import type { SessionUser } from '../http/context.js';
import { blocksOnDate } from '../db/repo/bookings.js';
import { listStations } from '../db/repo/catalog.js';
import { listTenants } from '../db/repo/tenants.js';
import { stationJson } from '../routes/serialize.js';
import { cleaningSpans } from '../domain/availability.js';
import { BOOKING_WINDOW_DAYS, DIAL_PAST_DAYS, KITCHEN } from '../domain/constants.js';
import {
  daysBetween,
  isValidDate,
  kitchenMinuteOf,
  kitchenToday,
  toKitchenIso,
  transitionsOn,
} from '../domain/time.js';
import type { BookingRecord } from '../domain/types.js';

export interface DialResponse {
  date: string;
  today: string;
  now_minute: number | null;
  time_zone: string;
  skipped: [number, number] | null;
  repeated: [number, number] | null;
  stations: Record<string, unknown>[];
}

function ownBlock(
  booking: BookingRecord,
  tenantName: string,
  holdExpiresAt: Date | null,
  contactEmail: string | null,
): Record<string, unknown> {
  const block: Record<string, unknown> = {
    kind: booking.status === 'held' ? 'hold' : 'booking',
    booking_id: booking.id,
    ref: booking.ref,
    hold_ref: booking.holdRef,
    status: booking.status,
    start_minute: booking.startMinute,
    end_minute: booking.endMinute,
    tenant_id: booking.tenantId,
    tenant_name: tenantName,
    notes: booking.notes,
    expires_at: holdExpiresAt ? toKitchenIso(holdExpiresAt) : null,
  };
  if (contactEmail !== null) block['contact_email'] = contactEmail;
  return block;
}

export async function dialDay(actor: SessionUser, requestedDate: string | null): Promise<DialResponse> {
  const now = new Date();
  const today = kitchenToday(now);
  const date = requestedDate ?? today;
  if (!isValidDate(date)) throw errors.validation({ date: 'Give a date as YYYY-MM-DD.' });
  const offset = daysBetween(today, date);
  if (offset < -DIAL_PAST_DAYS || offset > BOOKING_WINDOW_DAYS) {
    throw errors.validation({ date: 'That day is outside the dial range.' });
  }

  const [stations, tenants, blocks] = await Promise.all([
    listStations(),
    listTenants(),
    blocksOnDate(date, now),
  ]);
  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const transitions = transitionsOn(date);

  return {
    date,
    today,
    now_minute: date === today ? kitchenMinuteOf(now) : null,
    time_zone: KITCHEN.timeZone,
    skipped: transitions.skipped,
    repeated: transitions.repeated,
    stations: stations.map((station) => {
      const onStation = blocks.filter((entry) => entry.booking.stationId === station.id);
      const visible: Record<string, unknown>[] = onStation.map(({ booking, holdExpiresAt }) => {
        const tenant = tenantsById.get(booking.tenantId);
        const tenantName = tenant ? tenant.businessName : booking.tenantId;
        if (actor.role === 'operator') {
          return ownBlock(booking, tenantName, holdExpiresAt, tenant ? tenant.ownerEmail : null);
        }
        if (booking.tenantId === actor.tenantId) {
          return ownBlock(booking, tenantName, holdExpiresAt, null);
        }
        return {
          kind: 'booked',
          start_minute: booking.startMinute,
          end_minute: booking.endMinute,
        };
      });
      const cleaning = cleaningSpans(
        onStation.map(({ booking }) => ({
          tenantId: booking.tenantId,
          startMinute: booking.startMinute,
          endMinute: booking.endMinute,
        })),
      ).map((span) => ({
        kind: 'cleaning',
        start_minute: span.startMinute,
        end_minute: span.endMinute,
      }));
      return {
        ...stationJson(station),
        blocks: [...visible, ...cleaning].sort(
          (a, b) => (a['start_minute'] as number) - (b['start_minute'] as number),
        ),
      };
    }),
  };
}
