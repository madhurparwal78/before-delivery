import { nowMs } from '../clock';
import { query } from '../db';
import { validationError } from '../http/errors';
import type { HandlerResult, RequestContext } from '../http/context';
import { requireSiteInScope } from './session';
import { memberByUser } from '../domain/members';
import { sweepExpiredHolds } from '../domain/bookings';
import { sanitationBufferMinutes } from '../domain/rules';
import { isDate, localParts, localToInstant, minutesToWall, nonexistentRange } from '../../shared/tz';
import type {
  AvailabilitySector,
  AvailabilityStation,
  SectorKind,
  StationKind,
} from '../../shared/types';

interface StationRow {
  id: string;
  name: string;
  kind: StationKind;
}

interface OccupyingBooking {
  id: string;
  station_id: string;
  member_id: string;
  status: 'held' | 'confirmed' | 'checked_in';
  start_at: Date;
  end_at: Date;
}

function minutesOnDate(
  zone: string,
  dayStartMs: number,
  dayEndMs: number,
  instantMs: number,
): number {
  if (instantMs <= dayStartMs) return 0;
  if (instantMs >= dayEndMs) return 1440;
  const parts = localParts(zone, instantMs);
  return parts.hour * 60 + parts.minute;
}

export async function getAvailability(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const site = await requireSiteInScope(ctx, ctx.params.site_id as string);
  const date = ctx.query.get('date');
  if (date === null || !isDate(date)) {
    throw validationError({ date: 'Give a date as YYYY-MM-DD.' });
  }
  await sweepExpiredHolds();
  const at = nowMs();
  const zone = site.time_zone;
  const dayStart = localToInstant(zone, date, 0);
  const dayEnd = localToInstant(zone, date, 1440);
  const stations = await query<StationRow>(
    'select id, name, kind from stations where site_id = $1 order by display_order asc',
    [site.id],
  );
  const member = user.role === 'member' ? await memberByUser(user.user_id) : null;
  const bookings = await query<OccupyingBooking>(
    `select b.id, b.station_id, b.member_id, b.status, b.start_at, b.end_at
       from bookings b
      where b.site_id = $1
        and (b.status in ('confirmed','checked_in') or (b.status = 'held' and b.hold_expires_at > $4))
        and b.start_at < $3
        and b.occupied_end_at > $2`,
    [
      site.id,
      new Date(dayStart).toISOString(),
      new Date(dayEnd).toISOString(),
      new Date(at).toISOString(),
    ],
  );
  const missing = nonexistentRange(zone, date);
  const stationJson: AvailabilityStation[] = stations.map((station) => {
    const buffer = sanitationBufferMinutes(station.kind);
    const sectors: AvailabilitySector[] = [];
    for (const booking of bookings) {
      if (booking.station_id !== station.id) continue;
      const own = member !== null && booking.member_id === member.id;
      const bookingKind: SectorKind = own
        ? booking.status === 'held'
          ? 'own_held'
          : 'own_confirmed'
        : 'booked';
      const exposeId = own || user.role === 'kitchen_manager';
      const startAt = booking.start_at.getTime();
      const endAt = booking.end_at.getTime();
      if (startAt < dayEnd && endAt > dayStart) {
        const start = minutesOnDate(zone, dayStart, dayEnd, startAt);
        const end = minutesOnDate(zone, dayStart, dayEnd, endAt);
        if (end > start) {
          sectors.push({
            kind: bookingKind,
            start: minutesToWall(start),
            end: minutesToWall(end),
            booking_id: exposeId ? booking.id : null,
          });
        }
      }
      const bufferEnd = endAt + buffer * 60000;
      if (endAt < dayEnd && bufferEnd > dayStart) {
        const start = minutesOnDate(zone, dayStart, dayEnd, endAt);
        const end = minutesOnDate(zone, dayStart, dayEnd, bufferEnd);
        if (end > start) {
          sectors.push({
            kind: 'buffer',
            start: minutesToWall(start),
            end: minutesToWall(end),
            booking_id: exposeId ? booking.id : null,
          });
        }
      }
    }
    if (missing !== null) {
      sectors.push({
        kind: 'nonexistent',
        start: minutesToWall(missing.startMinutes),
        end: minutesToWall(missing.endMinutes),
        booking_id: null,
      });
    }
    sectors.sort((left, right) =>
      left.start === right.start ? left.end.localeCompare(right.end) : left.start.localeCompare(right.start),
    );
    return { id: station.id, name: station.name, kind: station.kind, sectors };
  });
  return {
    status: 200,
    body: { site_id: site.id, date, stations: stationJson },
  };
}
