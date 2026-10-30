import { randomBytes } from 'node:crypto';

import type { Packet, PacketDay, PacketSnapshot, PacketVisit } from '../../shared/api.js';
import { documentCoversDate, isPacketLinkUsable } from '../../shared/domain.js';
import { formatClock, formatInstant } from '../../shared/time.js';
import { KITCHEN_NAME } from '../db/seed.js';
import { renderTextPdf, type PdfLine } from '../services/pdf.js';
import type { Queryable } from './kitchen.js';

export interface PacketRow {
  id: string;
  from_date: string;
  to_date: string;
  expires_at: Date;
  status: 'active' | 'revoked';
  token: string | null;
  snapshot: PacketSnapshot;
  created_at: Date;
}

/** At least 32 random bytes, URL-safe, so a token is at least 43 characters. */
export function newPacketToken(): string {
  return randomBytes(36).toString('base64url');
}

export function packetStorageKey(packetId: string): string {
  return `packets/${packetId}.pdf`;
}

export function packetStatus(row: PacketRow, now: Date): Packet['status'] {
  if (row.status === 'revoked') return 'revoked';
  return now.getTime() < row.expires_at.getTime() ? 'active' : 'expired';
}

export function packetView(row: PacketRow, now: Date, timeZone: string): Packet {
  const status = packetStatus(row, now);
  const usable = status === 'active';
  return {
    id: row.id,
    from: row.from_date,
    to: row.to_date,
    expires_at: formatInstant(row.expires_at, timeZone),
    status,
    url: usable && row.token !== null ? `/packet/${row.token}` : null,
    token: usable ? row.token : null,
    created_at: formatInstant(row.created_at, timeZone),
  };
}

export async function findPacket(db: Queryable, id: string): Promise<PacketRow | null> {
  const result = await db.query<PacketRow>(
    `SELECT id, from_date, to_date, expires_at, status, token, snapshot, created_at
       FROM packets WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findUsablePacketByToken(
  db: Queryable,
  token: string,
  now: Date,
): Promise<PacketRow | null> {
  const result = await db.query<PacketRow>(
    `SELECT id, from_date, to_date, expires_at, status, token, snapshot, created_at
       FROM packets WHERE token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return isPacketLinkUsable(row.status, row.expires_at, now) ? row : null;
}

interface VisitRow {
  booking_id: string;
  kitchen_date: string;
  business_name: string;
  member_id: string;
  station_name: string;
  start_minutes: number;
  end_minutes: number;
}

/**
 * A snapshot of every booking with at least one check-in in the range. Only
 * the fields listed in the brief are recorded: no emails, ids, prices or notes.
 */
export async function buildSnapshot(
  db: Queryable,
  from: string,
  to: string,
  now: Date,
  timeZone: string,
): Promise<PacketSnapshot> {
  const visits = await db.query<VisitRow>(
    `SELECT DISTINCT b.id AS booking_id, b.kitchen_date, m.business_name, b.member_id,
            s.name AS station_name, b.start_minutes, b.end_minutes
       FROM bookings b
       JOIN members m ON m.id = b.member_id
       JOIN stations s ON s.id = b.station_id
      WHERE b.kitchen_date BETWEEN $1::date AND $2::date
        AND EXISTS (SELECT 1 FROM check_ins c WHERE c.booking_id = b.id)
      ORDER BY b.kitchen_date, b.start_minutes`,
    [from, to],
  );

  const days = new Map<string, PacketVisit[]>();
  for (const visit of visits.rows) {
    const insurance = await db.query<{ expires_on: string }>(
      `SELECT expires_on FROM documents
        WHERE member_id = $1 AND kind = 'liability_insurance' AND status = 'approved'
        ORDER BY expires_on DESC`,
      [visit.member_id],
    );
    const coveringInsurance = insurance.rows.find((row) =>
      documentCoversDate(row.expires_on, visit.kitchen_date),
    );

    const crewRows = await db.query<{
      name: string;
      at: Date;
      crew_cook_id: string;
    }>(
      `SELECT u.name, c.at, c.crew_cook_id
         FROM check_ins c JOIN users u ON u.id = c.crew_cook_id
        WHERE c.booking_id = $1 ORDER BY c.at, c.id`,
      [visit.booking_id],
    );

    const crew = [];
    for (const member of crewRows.rows) {
      const cards = await db.query<{ expires_on: string }>(
        `SELECT expires_on FROM documents
          WHERE crew_cook_id = $1 AND kind = 'food_handler_card' AND status = 'approved'
          ORDER BY expires_on DESC`,
        [member.crew_cook_id],
      );
      const coveringCard = cards.rows.find((row) =>
        documentCoversDate(row.expires_on, visit.kitchen_date),
      );
      crew.push({
        name: member.name,
        checked_in_at: formatInstant(member.at, timeZone),
        food_handler_card: {
          valid: coveringCard !== undefined,
          expires_on: coveringCard?.expires_on ?? cards.rows[0]?.expires_on ?? null,
        },
      });
    }

    const list = days.get(visit.kitchen_date) ?? [];
    list.push({
      business_name: visit.business_name,
      station: visit.station_name,
      start: formatClock(visit.start_minutes),
      end: formatClock(visit.end_minutes),
      liability_insurance: {
        valid: coveringInsurance !== undefined,
        expires_on: coveringInsurance?.expires_on ?? insurance.rows[0]?.expires_on ?? null,
      },
      crew,
    });
    days.set(visit.kitchen_date, list);
  }

  const orderedDays: PacketDay[] = [...days.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([date, list]) => ({
      date,
      visits: list.sort((left, right) => (left.start < right.start ? -1 : 1)),
    }));

  return {
    kitchen: KITCHEN_NAME,
    time_zone: timeZone,
    from,
    to,
    generated_at: formatInstant(now, timeZone),
    days: orderedDays,
  };
}

const VALIDITY_WORDS = (valid: boolean): string => (valid ? 'Valid' : 'Not valid');

/** The stored PDF carries the same snapshot the JSON and the page show. */
export function renderPacketPdf(snapshot: PacketSnapshot): Buffer {
  const lines: PdfLine[] = [
    { text: snapshot.kitchen, size: 20, bold: true, gap: 4 },
    { text: 'Compliance packet', size: 14, bold: true },
    { text: `Dates ${snapshot.from} to ${snapshot.to}`, size: 11 },
    { text: `Generated ${snapshot.generated_at}`, size: 9, gap: 10 },
  ];

  if (snapshot.days.length === 0) {
    lines.push({ text: 'No kitchen visits in this date range.', size: 11 });
  }

  for (const day of snapshot.days) {
    lines.push({ text: day.date, size: 13, bold: true, gap: 6 });
    for (const visit of day.visits) {
      lines.push({
        text: `${visit.business_name} — ${visit.station} — ${visit.start}–${visit.end}`,
        size: 11,
        bold: true,
      });
      lines.push({
        text:
          `Liability insurance: ${VALIDITY_WORDS(visit.liability_insurance.valid)}` +
          (visit.liability_insurance.expires_on === null
            ? ''
            : ` (expires ${visit.liability_insurance.expires_on})`),
        size: 10,
      });
      if (visit.crew.length === 0) {
        lines.push({ text: 'Crew and card: none recorded', size: 10, gap: 4 });
      }
      for (const cook of visit.crew) {
        lines.push({
          text:
            `Crew: ${cook.name} — checked in ${cook.checked_in_at} — ` +
            `food handler card: ${VALIDITY_WORDS(cook.food_handler_card.valid)}` +
            (cook.food_handler_card.expires_on === null
              ? ''
              : ` (expires ${cook.food_handler_card.expires_on})`),
          size: 10,
        });
      }
      lines.push({ text: ' ', size: 4 });
    }
  }

  return renderTextPdf(lines);
}
