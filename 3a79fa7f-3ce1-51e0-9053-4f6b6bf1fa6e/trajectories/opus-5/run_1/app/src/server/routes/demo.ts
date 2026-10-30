import { isoSeconds, now } from '../clock.js';
import { one, query, withTransaction } from '../db.js';
import { fail, failValidation } from '../errors.js';
import { reply, type Router } from '../http.js';
import { requireCustomer } from '../auth.js';
import { countryRule } from '../domain/countries.js';
import { haversineKm, maskEmail, roundToTenth, slotLabel } from '../domain/locations.js';
import { DEMO_CREDIT_CENTS } from '../domain/checkout.js';
import { queueNotice } from '../services/notices.js';

const BOOKING_CLOSE_SECONDS = 3600;
const CANCEL_CUTOFF_SECONDS = 86400;
export const DEMO_CREDIT_LIFETIME_SECONDS = 7776000;

export interface LocationRow {
  id: number;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  timezone: string;
  opening_hours: string;
}

interface SlotRow {
  id: string;
  location_id: number;
  starts_at: Date;
  ends_at: Date;
  capacity: number;
  timezone: string;
  taken: string;
}

export function locationShape(row: LocationRow, distanceKm: number | null): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    country: row.country,
    timezone: row.timezone,
    opening_hours: row.opening_hours,
    lat: row.lat,
    lon: row.lon,
    distance_km: distanceKm,
  };
}

export function slotShape(row: SlotRow): Record<string, unknown> {
  return {
    id: Number(row.id),
    location_id: row.location_id,
    starts_at: isoSeconds(row.starts_at),
    ends_at: isoSeconds(row.ends_at),
    capacity: row.capacity,
    seats_left: Math.max(0, row.capacity - Number(row.taken)),
    timezone: row.timezone,
    label: slotLabel(row.starts_at, row.ends_at, row.timezone),
  };
}

const SLOT_SELECT = `
  SELECT s.id, s.location_id, s.starts_at, s.ends_at, s.capacity, l.timezone,
         (SELECT count(*) FROM demo_bookings b WHERE b.slot_id = s.id AND b.status IN ('booked','attended')) AS taken
  FROM demo_slots s JOIN locations l ON l.id = s.location_id`;

export function bookingShape(
  row: { id: string; slot_id: string; status: string; customer_email: string },
  masked: boolean,
): Record<string, unknown> {
  return {
    id: Number(row.id),
    slot_id: Number(row.slot_id),
    status: row.status,
    customer_email: masked ? maskEmail(row.customer_email) : row.customer_email,
  };
}

function parseCoordinate(raw: string | null, field: 'lat' | 'lon'): number | null {
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  const limit = field === 'lat' ? 90 : 180;
  if (!Number.isFinite(value) || Math.abs(value) > limit) failValidation({ [field]: 'Enter a valid coordinate.' });
  return value;
}

export function registerDemoRoutes(router: Router): void {
  router.add('GET', '/api/locations', 'anyone', async (ctx) => {
    const lat = parseCoordinate(ctx.url.searchParams.get('lat'), 'lat');
    const lon = parseCoordinate(ctx.url.searchParams.get('lon'), 'lon');
    const rawRadius = ctx.url.searchParams.get('radius_km');
    let radiusKm = 100;
    if (rawRadius !== null && rawRadius !== '') {
      if (!/^[0-9]+$/.test(rawRadius) || Number(rawRadius) < 1 || Number(rawRadius) > 500) {
        failValidation({ radius_km: 'Choose a radius up to 500 km.' });
      }
      radiusKm = Number(rawRadius);
    }
    const country = ctx.url.searchParams.get('country');
    if (country && !countryRule(country)) fail('unsupported_country');

    const all = await query<LocationRow>('SELECT * FROM locations ORDER BY name', []);
    const filtered = country ? all.filter((row) => row.country === country) : all;

    if (lat === null || lon === null) {
      return { locations: filtered.map((row) => locationShape(row, null)) };
    }
    const measured = filtered
      .map((row) => ({ row, distance: roundToTenth(haversineKm(lat, lon, row.lat, row.lon)) }))
      .filter((entry) => entry.distance <= radiusKm)
      .sort((a, b) => (a.distance !== b.distance ? a.distance - b.distance : a.row.name.localeCompare(b.row.name)));
    return { locations: measured.map((entry) => locationShape(entry.row, entry.distance)) };
  });

  router.add('GET', '/api/locations/:id/slots', 'anyone', async (ctx) => {
    const id = ctx.params.id ?? '';
    if (!/^[0-9]+$/.test(id)) fail('not_found');
    const location = await query<{ id: number }>('SELECT id FROM locations WHERE id = $1', [id]);
    if (location.length === 0) fail('not_found');
    const found = await query<SlotRow>(
      `${SLOT_SELECT} WHERE s.location_id = $1 AND s.starts_at > $2 ORDER BY s.starts_at, s.id`,
      [id, now()],
    );
    return { slots: found.map(slotShape) };
  });

  router.add('POST', '/api/demo-bookings', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const slotId = ctx.body.slot_id;
    if (!Number.isInteger(slotId)) fail('not_found');

    return withTransaction(async (client) => {
      const slot = await one<{ id: string; starts_at: Date; ends_at: Date; capacity: number; location_id: number }>(
        client,
        'SELECT id, starts_at, ends_at, capacity, location_id FROM demo_slots WHERE id = $1 FOR UPDATE',
        [slotId],
      );
      if (!slot) fail('not_found');
      if (at.getTime() >= slot.starts_at.getTime() - BOOKING_CLOSE_SECONDS * 1000) fail('booking_closed');

      const overlapping = await one<{ id: string }>(
        client,
        `SELECT b.id FROM demo_bookings b JOIN demo_slots s ON s.id = b.slot_id
         WHERE b.user_id = $1 AND b.status = 'booked' AND s.starts_at < $3 AND $2 < s.ends_at LIMIT 1`,
        [session.userId, slot.starts_at, slot.ends_at],
      );
      if (overlapping) fail('already_booked');

      const taken = await one<{ count: string }>(
        client,
        `SELECT count(*) AS count FROM demo_bookings WHERE slot_id = $1 AND status IN ('booked','attended')`,
        [slot.id],
      );
      if (Number(taken?.count ?? 0) >= slot.capacity) fail('slot_full');

      const created = await one<{ id: string }>(
        client,
        `INSERT INTO demo_bookings (slot_id, user_id, status, created_at) VALUES ($1,$2,'booked',$3) RETURNING id`,
        [slot.id, session.userId, at],
      );
      if (!created) throw new Error('Booking was not stored');

      const location = await one<{ name: string }>(client, 'SELECT name FROM locations WHERE id = $1', [
        slot.location_id,
      ]);
      await queueNotice(
        client,
        {
          to: session.email,
          template: 'demo_booked',
          reference: created.id,
          subject: `Demo booked: ${location?.name ?? ''}`,
          body: `Your demo seat is booked.\nReference ${created.id}\n${location?.name ?? ''}`,
        },
        at,
      );
      return reply(201, {
        id: Number(created.id),
        slot_id: Number(slot.id),
        status: 'booked',
        customer_email: session.email,
      });
    });
  });

  router.add('GET', '/api/demo-bookings/mine', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const found = await query<{ id: string; slot_id: string; status: string; customer_email: string }>(
      `SELECT b.id, b.slot_id, b.status, u.email AS customer_email FROM demo_bookings b
       JOIN users u ON u.id = b.user_id WHERE b.user_id = $1 ORDER BY b.id`,
      [session.userId],
    );
    return { bookings: found.map((row) => bookingShape(row, false)) };
  });

  router.add('POST', '/api/demo-bookings/:id/cancel', 'customer', async (ctx) => {
    const session = requireCustomer(ctx);
    const at = now();
    const id = ctx.params.id ?? '';
    if (!/^[0-9]+$/.test(id)) fail('not_found');
    const booking = (
      await query<{ id: string; slot_id: string; status: string; starts_at: Date }>(
        `SELECT b.id, b.slot_id, b.status, s.starts_at FROM demo_bookings b JOIN demo_slots s ON s.id = b.slot_id
         WHERE b.id = $1 AND b.user_id = $2`,
        [id, session.userId],
      )
    )[0];
    if (!booking) fail('not_found');
    if (booking.status !== 'booked') fail('illegal_transition', { message: 'This booking cannot be changed now.' });
    if (at.getTime() >= booking.starts_at.getTime() - CANCEL_CUTOFF_SECONDS * 1000) fail('too_late');

    await query(`UPDATE demo_bookings SET status = 'cancelled' WHERE id = $1`, [booking.id]);
    return bookingShape({ ...booking, status: 'cancelled', customer_email: session.email }, false);
  });

  router.add('GET', '/api/events', 'anyone', async () => {
    const today = isoSeconds(now()).slice(0, 10);
    const found = await query<{
      id: number;
      title: string;
      location_id: number;
      location_name: string;
      city: string;
      starts_on: Date | string;
      ends_on: Date | string;
    }>(
      `SELECT e.id, e.title, e.location_id, l.name AS location_name, l.city, e.starts_on, e.ends_on
       FROM demo_events e JOIN locations l ON l.id = e.location_id
       WHERE e.ends_on >= $1 ORDER BY e.starts_on, e.id`,
      [today],
    );
    return {
      events: found.map((row) => ({
        id: row.id,
        title: row.title,
        location_id: row.location_id,
        location_name: row.location_name,
        city: row.city,
        starts_on: typeof row.starts_on === 'string' ? row.starts_on.slice(0, 10) : row.starts_on.toISOString().slice(0, 10),
        ends_on: typeof row.ends_on === 'string' ? row.ends_on.slice(0, 10) : row.ends_on.toISOString().slice(0, 10),
      })),
    };
  });
}

export { DEMO_CREDIT_CENTS, SLOT_SELECT };
