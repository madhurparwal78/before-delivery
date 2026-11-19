import type pg from 'pg';

export interface StayRow {
  id: string;
  hotel_id: string;
  guest_id: string;
  rate_plan_id: string;
  guests: number;
  arrival: string;
  departure: string;
  status: 'booked' | 'in_house' | 'checked_out' | 'cancelled' | 'no_show';
  version: number;
  checked_in_online: boolean;
  online_checkin_name: string | null;
  online_checkin_phone: string | null;
  check_in_night: string | null;
  id_photo_key: string | null;
  id_photo: Buffer | null;
  created_at: Date;
}

export interface NightRow {
  id: string;
  stay_id: string;
  date: string;
  room_id: string;
  room_cents: number;
  tax_cents: number;
  city_tax_cents: number;
  posted: boolean;
}

export interface FolioRow {
  id: string;
  hotel_id: string;
  stay_id: string;
  name: string;
  payer_name: string;
  payer_email: string;
  state: 'open' | 'closed';
  letter: string;
}

export interface EntryRow {
  id: string;
  folio_id: string;
  kind: 'charge' | 'payment';
  date: string;
  description: string;
  amount_cents: number;
  room_number: string | null;
  reverses_entry_id: string | null;
  split_of_entry_id: string | null;
  seq: string;
}

export interface RoomRow {
  id: string;
  hotel_id: string;
  number: string;
  type: string;
  status: 'dirty' | 'clean' | 'inspected' | 'out_of_order';
}

export interface GuestRow {
  id: string;
  hotel_id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
}

export interface InvoiceRow {
  id: string;
  hotel_id: string;
  folio_id: string;
  number: string;
  state: string;
  mail_state: 'not_sent' | 'sent';
  bill_to_name: string;
  payer_email: string;
  pdf_key: string;
}

export async function stayNights(client: pg.PoolClient, stayId: string): Promise<NightRow[]> {
  const res = await client.query(
    'SELECT * FROM stay_nights WHERE stay_id = $1 ORDER BY date', [stayId]);
  return res.rows as NightRow[];
}

export async function stayFolios(client: pg.PoolClient, stayId: string): Promise<FolioRow[]> {
  const res = await client.query(
    'SELECT * FROM folios WHERE stay_id = $1 ORDER BY letter', [stayId]);
  return res.rows as FolioRow[];
}

export async function folioEntries(client: pg.PoolClient, folioId: string): Promise<EntryRow[]> {
  const res = await client.query(
    'SELECT * FROM entries WHERE folio_id = $1 ORDER BY seq, id', [folioId]);
  return res.rows as EntryRow[];
}

export async function staySegments(client: pg.PoolClient, stayId: string) {
  const res = await client.query(
    `SELECT sr.room_id, r.number AS room_number, sr.first_night, sr.nights
     FROM stay_segments sr JOIN rooms r ON r.id = sr.room_id
     WHERE sr.stay_id = $1 ORDER BY sr.first_night`, [stayId]);
  return res.rows as Array<{ room_id: string; room_number: string; first_night: string; nights: number }>;
}

export function folioBalance(entries: EntryRow[]): number {
  return entries.reduce((sum, e) => sum + (e.kind === 'charge' ? e.amount_cents : -e.amount_cents), 0);
}

export function nextFolioLetter(existing: string[]): string {
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!existing.includes(letter)) return letter;
  }
  return 'Z';
}

export async function roomHoldsNight(client: pg.PoolClient, roomId: string, date: string, excludeStayId?: string): Promise<string | null> {
  const res = await client.query(
    `SELECT sn.stay_id FROM stay_nights sn JOIN stays s ON s.id = sn.stay_id
     WHERE sn.room_id = $1 AND sn.date = $2 AND s.status IN ('booked','in_house')
     AND ($3::text IS NULL OR sn.stay_id <> $3)`,
    [roomId, date, excludeStayId ?? null]);
  return res.rows[0]?.stay_id ?? null;
}

export async function firstHeldNight(client: pg.PoolClient, roomId: string, dates: string[], excludeStayId?: string): Promise<string | null> {
  for (const date of dates) {
    const held = await roomHoldsNight(client, roomId, date, excludeStayId);
    if (held) return date;
  }
  return null;
}
