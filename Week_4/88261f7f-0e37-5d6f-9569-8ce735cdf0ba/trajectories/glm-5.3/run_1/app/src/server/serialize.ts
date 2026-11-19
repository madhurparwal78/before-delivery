import type pg from 'pg';
import type { Entry, Folio, Invoice, Night, Stay } from '../shared/types.js';
import { formatMoney } from '../shared/format.js';
import { addDays, localEvening } from './dates.js';
import {
  EntryRow, FolioRow, NightRow, StayRow,
  stayNights, stayFolios, folioEntries, staySegments, folioBalance
} from './store.js';

type StayRowWithPhoto = StayRow & { id_photo_key: string | null; id_photo: Buffer | null };

export async function serializeStay(client: pg.PoolClient, stayId: string, ctx: {
  businessDate: string;
  timeZone: string;
  now: Date;
}): Promise<Stay> {
  const stayRes = await client.query('SELECT * FROM stays WHERE id = $1', [stayId]);
  const stay = stayRes.rows[0] as StayRowWithPhoto;
  const guestRes = await client.query('SELECT id, name, email, phone FROM guests WHERE id = $1', [stay.guest_id]);
  const guest = guestRes.rows[0];
  const nights = await stayNights(client, stayId);
  const folios = await stayFolios(client, stayId);
  const segments = await staySegments(client, stayId);
  return serializeStayRows(client, stay, guest, nights, folios, segments, ctx);
}

export async function serializeStayRows(
  client: pg.PoolClient,
  stay: StayRowWithPhoto,
  guest: { id: string; name: string; email: string; phone: string },
  nights: NightRow[],
  folioRows: FolioRow[],
  segments: Array<{ room_id: string; room_number: string; first_night: string; nights: number }>,
  ctx: { businessDate: string; timeZone: string; now: Date }
): Promise<Stay> {
  const entriesByFolio: Record<string, EntryRow[]> = {};
  for (const f of folioRows) entriesByFolio[f.id] = await folioEntries(client, f.id);
  const nightly: Night[] = nights.map(n => ({
    date: n.date, roomNumber: '', roomCents: n.room_cents, taxCents: n.tax_cents,
    cityTaxCents: n.city_tax_cents, totalCents: n.room_cents + n.tax_cents + n.city_tax_cents,
    posted: n.posted
  }));
  const roomNumbers = new Map<string, string>();
  for (const n of nights) {
    const r = await client.query('SELECT number FROM rooms WHERE id = $1', [n.room_id]);
    roomNumbers.set(n.date, r.rows[0]?.number ?? '');
  }
  for (const n of nightly) n.roomNumber = roomNumbers.get(n.date) ?? '';
  const folios: Folio[] = [];
  for (const f of folioRows) {
    const entries = entriesByFolio[f.id] ?? [];
    let invoice: InvoiceRowLike | null = null;
    if (f.state === 'closed') {
      const invRes = await client.query('SELECT * FROM invoices WHERE folio_id = $1', [f.id]);
      invoice = invRes.rows[0] ?? null;
    }
    folios.push({
      id: f.id, name: f.name, payerName: f.payer_name, payerEmail: f.payer_email,
      state: f.state, balanceCents: folioBalance(entries),
      entries: entries.map(serializeEntry),
      invoice: invoice ? serializeInvoice(invoice) : null
    });
  }
  const totalCents = nightly.reduce((s, n) => s + n.totalCents, 0);
  return {
    id: stay.id,
    version: stay.version,
    status: stay.status,
    guest: { id: guest.id, name: guest.name, email: guest.email, phone: guest.phone },
    ratePlanId: stay.rate_plan_id,
    guests: stay.guests,
    arrival: stay.arrival,
    departure: stay.departure,
    segments: segments.map(s => ({ roomId: s.room_id, roomNumber: s.room_number, firstNight: s.first_night, nights: s.nights })),
    checkedInOnline: stay.checked_in_online,
    onlineCheckIn: stay.online_checkin_name ? { fullName: stay.online_checkin_name, phone: stay.online_checkin_phone ?? '' } : null,
    checkinLinkState: await checkinLinkState(client, stay),
    checkInNight: stay.check_in_night,
    idPhoto: stay.id_photo_key ? 'received' : 'none',
    nightly, totalCents,
    cancellation: cancellationFor(stay, nightly, ctx),
    folios
  };
}

interface InvoiceRowLike {
  id: string; number: string; state: string; mail_state: string;
  bill_to_name: string; payer_email: string; pdf_key: string;
}

export function serializeInvoice(inv: InvoiceRowLike): Invoice {
  return {
    id: inv.id, number: inv.number, state: 'issued',
    mailState: inv.mail_state === 'sent' ? 'sent' : 'not_sent',
    billToName: inv.bill_to_name, payerEmail: inv.payer_email,
    pdfUrl: `/api/invoices/${inv.id}/pdf`
  };
}

export function serializeEntry(e: EntryRow): Entry {
  return {
    id: e.id, kind: e.kind, date: e.date, description: e.description,
    amountCents: e.amount_cents, roomNumber: e.room_number,
    reversesEntryId: e.reverses_entry_id, splitOfEntryId: e.split_of_entry_id
  };
}

async function checkinLinkState(client: pg.PoolClient, stay: StayRow): Promise<'not_sent' | 'sent' | 'ended'> {
  if (stay.status !== 'booked' || stay.checked_in_online) return 'ended';
  const tokenRes = await client.query(
    'SELECT token, sent_at, mail_sent, accepted_at FROM checkin_tokens WHERE stay_id = $1 ORDER BY sent_at DESC LIMIT 1', [stay.id]);
  const row = tokenRes.rows[0];
  if (!row) return 'not_sent';
  if (row.accepted_at) return 'ended';
  return row.mail_sent ? 'sent' : 'not_sent';
}

export function cancellationFor(stay: StayRow, nightly: Night[], ctx: { businessDate: string; timeZone: string; now: Date }): Stay['cancellation'] {
  if (stay.status !== 'booked') return null;
  const first = nightly[0];
  if (!first) return null;
  const deadline = localEvening(addDays(first.date, -1), ctx.timeZone);
  const late = ctx.now.getTime() >= deadline.getTime();
  return late
    ? { state: 'late', feeCents: first.totalCents, text: `Late cancellation fee: ${formatMoney(first.totalCents)}` }
    : { state: 'free', feeCents: 0, text: `Free cancellation until ${addDays(first.date, -1)} 18:00` };
}

export async function loadInvoiceForFolio(client: pg.PoolClient, folioId: string): Promise<InvoiceRowLike | null> {
  const res = await client.query('SELECT * FROM invoices WHERE folio_id = $1', [folioId]);
  return res.rows[0] ?? null;
}
