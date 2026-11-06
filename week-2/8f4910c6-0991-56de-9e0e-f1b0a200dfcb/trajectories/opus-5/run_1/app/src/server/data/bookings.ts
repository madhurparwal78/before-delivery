import { query } from '../db.js';
import { toIsoInstant } from '../../shared/zone.js';
import type { Booking, BookingState, LineKind, OfficeId } from '../../shared/types.js';

export type BookingRow = {
  id: string;
  reference: string;
  state: BookingState;
  job_date: string;
  office_id: OfficeId;
  client_id: string;
  job_title: string;
  rate_card_id: string;
  talent_fees_cents: number;
  service_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  killbill_invoice_id: string | null;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  confirmed_at: Date | null;
  issued_by: string | null;
  issued_by_name: string | null;
  issued_at: Date | null;
};

type TalentRowOfBooking = {
  booking_id: string;
  talent_id: string;
  display_name: string;
  talent_fees_cents: number;
  service_fee_share_cents: number;
};

type LineRow = {
  booking_id: string;
  idx: number;
  kind: LineKind;
  label: string;
  talent_id: string | null;
  amount_cents: number;
};

export async function findBookingRow(id: string): Promise<BookingRow | null> {
  const rows = await query<BookingRow>('SELECT * FROM bookings WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function bookingViews(rows: BookingRow[]): Promise<Booking[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const talent = await query<TalentRowOfBooking>(
    'SELECT * FROM booking_talent WHERE booking_id = ANY($1::text[]) ORDER BY position',
    [ids],
  );
  const lines = await query<LineRow>(
    'SELECT * FROM booking_lines WHERE booking_id = ANY($1::text[]) ORDER BY idx',
    [ids],
  );
  const clients = await query<{ id: string; company: string }>(
    'SELECT id, company FROM clients WHERE id = ANY($1::text[])',
    [rows.map((row) => row.client_id)],
  );
  const cards = await query<{ id: string; name: string; effective_from: string }>(
    'SELECT id, name, effective_from FROM rate_cards WHERE id = ANY($1::text[])',
    [rows.map((row) => row.rate_card_id)],
  );

  return rows.map((row) => {
    const card = cards.find((candidate) => candidate.id === row.rate_card_id);
    return {
      id: row.id,
      reference: row.reference,
      state: row.state,
      date: row.job_date,
      office: row.office_id,
      clientId: row.client_id,
      clientCompany: clients.find((client) => client.id === row.client_id)?.company ?? '',
      jobTitle: row.job_title,
      rateCard: {
        id: row.rate_card_id,
        name: card?.name ?? '',
        effectiveFrom: card?.effective_from ?? '',
      },
      talent: talent
        .filter((entry) => entry.booking_id === row.id)
        .map((entry) => ({
          talentId: entry.talent_id,
          displayName: entry.display_name,
          talentFeesCents: entry.talent_fees_cents,
          serviceFeeShareCents: entry.service_fee_share_cents,
        })),
      lines: lines
        .filter((line) => line.booking_id === row.id)
        .map((line) => ({
          kind: line.kind,
          label: line.label,
          talentId: line.talent_id,
          amountCents: line.amount_cents,
        })),
      talentFeesCents: row.talent_fees_cents,
      serviceFeeCents: row.service_fee_cents,
      taxCents: row.tax_cents,
      totalCents: row.total_cents,
      killbillInvoiceId: row.killbill_invoice_id,
      confirmedBy: row.confirmed_by_name,
      confirmedAt: row.confirmed_at ? toIsoInstant(row.confirmed_at.getTime()) : null,
      issuedBy: row.issued_by_name,
      issuedAt: row.issued_at ? toIsoInstant(row.issued_at.getTime()) : null,
    };
  });
}

export async function bookingView(id: string): Promise<Booking> {
  const row = await findBookingRow(id);
  if (!row) throw new Error(`unknown booking ${id}`);
  return (await bookingViews([row]))[0];
}

export async function listBookingRows(filter: { office?: OfficeId; month?: string }): Promise<BookingRow[]> {
  return query<BookingRow>(
    `SELECT * FROM bookings
     WHERE ($1::text IS NULL OR office_id = $1)
       AND ($2::text IS NULL OR to_char(job_date, 'YYYY-MM') = $2)
     ORDER BY job_date DESC, created_at DESC`,
    [filter.office ?? null, filter.month ?? null],
  );
}
