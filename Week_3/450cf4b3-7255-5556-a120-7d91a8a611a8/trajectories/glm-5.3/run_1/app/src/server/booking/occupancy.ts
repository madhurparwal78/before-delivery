import { Tx, BookingRow } from '../store.js';
import { minutesOfDay, documentCovers } from '../domain/rules.js';
import { KitchenClock } from '../domain/kitchen.js';

export interface OccupiedInterval {
  start: number; end: number; bookingId: string; stationId: string;
  status: BookingRow['status']; tenantId: string; tenantName: string; mine: boolean;
}

// The occupancy read shared by the floor, cooler strip, claims and moves.
// Expired holds never block: their stored rows were swept to cancelled, and the
// live flag keeps only real occupancy in the result.
export async function readOccupancy(tx: Tx, dateKey: string, clock: KitchenClock): Promise<BookingRow[]> {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayStart = clock.fromWall(y, m, d, 0, 0, 0);
  const dayEnd = dayStart + 86_400_000 + 6 * 3_600_000;
  const r = await tx.query<BookingRow>(
    `SELECT b.* FROM bookings b
     WHERE b.live=1 AND b.start < $2 AND b.buffer_end > $1
     ORDER BY b.start`,
    [dayStart, dayEnd],
  );
  return r.rows;
}

export interface StationSpanMetrics {
  occupiedMinutes: number; bufferMinutes: number; freeMinutes: number;
}

// Station metrics for a requested span, from the shared occupancy read.
export function stationSpanMetrics(spanStart: number, spanEnd: number, bookings: BookingRow[], stationId: string): StationSpanMetrics {
  let occupied = 0;
  let buffer = 0;
  for (const b of bookings) {
    if (b.station_id !== stationId && b.shelf_id !== stationId) continue;
    const from = Math.max(spanStart, b.start);
    const to = Math.min(spanEnd, b.buffer_end);
    if (to <= from) continue;
    occupied += to - from;
    const cleanFrom = Math.max(spanStart, b.end);
    if (cleanFrom < to) buffer += to - cleanFrom;
  }
  occupied = Math.round(occupied / 60_000);
  buffer = Math.round(buffer / 60_000);
  const spanMinutes = Math.round((spanEnd - spanStart) / 60_000);
  return { occupiedMinutes: occupied, bufferMinutes: buffer, freeMinutes: Math.max(0, spanMinutes - occupied) };
}

// A shelf is free in a half hour only when no occupied period, buffer included,
// overlaps it by any length.
export function shelfFreeInHalfHour(halfStart: number, halfEnd: number, bookings: BookingRow[], shelfId: string): boolean {
  for (const b of bookings) {
    if (b.shelf_id !== shelfId) continue;
    if (b.start < halfEnd && b.buffer_end > halfStart) return false;
  }
  return true;
}

// Overlap check for claims and moves. The booking's own occupancy (selfId) is
// excluded so a shift overlapping itself succeeds.
export function overlapExists(bookings: BookingRow[], stationIds: string[], start: number, bufferEnd: number, selfId: string | null): boolean {
  for (const b of bookings) {
    if (b.id === selfId) continue;
    if (!stationIds.includes(b.station_id) && !(b.shelf_id && stationIds.includes(b.shelf_id))) continue;
    if (b.start < bufferEnd && b.buffer_end > start) return true;
  }
  return false;
}

// The document cover rule shared by bookings, clearance, onboarding and display.
export function tenantDocumentsCover(insuranceExpires: string | null, foodExpires: string | null, dateKey: string): boolean {
  if (insuranceExpires === null || foodExpires === null) return false;
  return documentCovers(insuranceExpires, dateKey) && documentCovers(foodExpires, dateKey);
}

export type ClearanceReason = 'not_approved' | 'insurance_lapsed' | 'food_handler_lapsed' | null;

export interface DoorClearance { cleared: boolean; reason: ClearanceReason }

// Clearance for a door date, in the published precedence.
export function clearanceFor(status: string, insuranceExpires: string | null, foodExpires: string | null, dateKey: string): DoorClearance {
  if (status !== 'approved' && status !== 'suspended') return { cleared: false, reason: 'not_approved' };
  if (insuranceExpires === null || !documentCovers(insuranceExpires, dateKey)) return { cleared: false, reason: 'insurance_lapsed' };
  if (foodExpires === null || !documentCovers(foodExpires, dateKey)) return { cleared: false, reason: 'food_handler_lapsed' };
  return { cleared: true, reason: null };
}

export function minutesOfDayOf(clock: KitchenClock, epoch: number): number {
  return minutesOfDay(clock, epoch);
}
