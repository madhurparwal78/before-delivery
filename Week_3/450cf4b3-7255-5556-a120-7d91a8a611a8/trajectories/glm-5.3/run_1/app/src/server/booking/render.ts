import { Tx, BookingRow, PackRow, DocumentRow } from '../store.js';
import { KitchenClock } from '../domain/kitchen.js';
import { coverState, cutoffFor, durationText } from '../domain/rules.js';
import { packBalance, packHeldMinutes } from './packs.js';
import { doorLogFor } from './door.js';

// Role-shaped responses: each renderer publishes exactly the field list the
// brief states for the caller's role.

export interface EmailStatusJson { kind: string; status: 'queued' | 'sent'; sentAt: string | null }

async function bookingEmails(tx: Tx, clock: KitchenClock, bookingId: string): Promise<EmailStatusJson[]> {
  const r = await tx.query<{ kind: string; status: string; sent_at: number | null }>(
    `SELECT kind, status, sent_at FROM mail_queue WHERE record_id=$1 AND kind IN ('booking_confirmed','booking_moved') ORDER BY created_at`,
    [bookingId],
  );
  return r.rows.map((row) => ({
    kind: row.kind,
    status: row.status === 'sent' ? 'sent' as const : 'queued' as const,
    sentAt: row.sent_at === null ? null : clock.iso(row.sent_at),
  }));
}

export interface BookingJson {
  id: string; stationId: string; stationName: string; shelfId: string | null; shelfName: string | null;
  start: string; end: string; bufferEnd: string; status: string;
  holdExpiresAt: string | null; packId: string | null; debitedMinutes: number | null;
  refundedMinutes: number | null; cancelReason: string | null; createdAt: string;
  cutoffAt: string; cancelCreditMinutes: number | null; moveCount: number; movable: boolean;
  emails: EmailStatusJson[];
  tenantId?: string; tenantName?: string; doorLog?: unknown[]; cleanupNote?: string | null;
}

export async function renderBooking(tx: Tx, clock: KitchenClock, b: BookingRow, role: 'tenant' | 'staff', now: number, stationNames: Map<string, string>): Promise<BookingJson> {
  const emails = await bookingEmails(tx, clock, b.id);
  const cutoff = cutoffFor(clock, b.start);
  const credit = b.status === 'confirmed' ? (now <= cutoff ? (b.debited_minutes ?? 0) : 0) : null;
  const movable = b.status === 'confirmed' && b.move_count === 0 && now <= cutoff;
  const base: BookingJson = {
    id: b.id,
    stationId: b.station_id,
    stationName: stationNames.get(b.station_id) ?? b.station_id,
    shelfId: b.shelf_id,
    shelfName: b.shelf_id ? (stationNames.get(b.shelf_id) ?? b.shelf_id) : null,
    start: clock.iso(b.start),
    end: clock.iso(b.end),
    bufferEnd: clock.iso(b.buffer_end),
    status: b.status,
    holdExpiresAt: b.hold_expires_at === null ? null : clock.iso(b.hold_expires_at),
    packId: b.pack_id,
    debitedMinutes: b.debited_minutes,
    refundedMinutes: b.refunded_minutes,
    cancelReason: b.cancel_reason,
    createdAt: clock.iso(b.created_at),
    cutoffAt: clock.iso(cutoff),
    cancelCreditMinutes: credit,
    moveCount: b.move_count,
    movable,
    emails,
  };
  if (role === 'staff') {
    const tenant = await tx.query<{ business_name: string }>(`SELECT business_name FROM tenants WHERE id=$1`, [b.tenant_id]);
    const log = await doorLogFor(tx, b.id);
    base.tenantId = b.tenant_id;
    base.tenantName = tenant.rows[0]?.business_name ?? '';
    base.doorLog = log.map((entry) => ({
      action: entry.action,
      at: clock.iso(entry.at),
      by: entry.by,
    }));
    base.cleanupNote = b.cleanup_note;
  }
  return base;
}

export interface PackJson {
  id: string; hours: number; purchasedMinutes: number; balanceMinutes: number;
  heldMinutes: number; availableMinutes: number; priceCents: number; status: string;
  invoiceId: string | null; purchasedAt: string; receiptEmail: { status: 'queued' | 'sent'; sentAt: string | null };
  refundableCents?: number; refundedCents?: number | null;
  entries?: Array<{ id: number; movementId: string; movement: string; side: string; minutes: number; bookingId: string | null; createdAt: string }>;
}

export async function renderPack(tx: Tx, clock: KitchenClock, p: PackRow, now: number, detail = false): Promise<PackJson> {
  const balance = await packBalance(tx, p.id);
  const held = await packHeldMinutes(tx, p.id, now);
  const receipt = await tx.query<{ status: string; sent_at: number | null }>(
    `SELECT status, sent_at FROM mail_queue WHERE kind='pack_receipt' AND record_id=$1 ORDER BY created_at LIMIT 1`,
    [p.id],
  );
  const json: PackJson = {
    id: p.id,
    hours: p.hours,
    purchasedMinutes: p.hours * 60,
    balanceMinutes: balance,
    heldMinutes: held,
    availableMinutes: balance - held,
    priceCents: p.price_cents,
    status: p.status,
    invoiceId: p.invoice_id,
    purchasedAt: clock.iso(p.purchased_at),
    receiptEmail: {
      status: receipt.rows[0]?.status === 'sent' ? 'sent' : 'queued',
      sentAt: receipt.rows[0]?.sent_at === null || receipt.rows[0] === undefined || receipt.rows[0].sent_at === null ? null : clock.iso(receipt.rows[0].sent_at),
    },
  };
  if (detail) {
    const refundable = p.status === 'refunded' ? 0 : Math.floor((p.price_cents * balance) / (p.hours * 60));
    json.refundableCents = refundable;
    json.refundedCents = p.refunded_cents;
    const entries = await tx.query<{
      id: number; movement_id: string; kind: string; side: string; minutes: number; booking_id: string | null; created_at: number;
    }>(
      `SELECT e.id, e.movement_id, m.kind, e.side, e.minutes, m.booking_id, e.created_at
       FROM ledger_entries e JOIN movements m ON m.id=e.movement_id
       WHERE m.pack_id=$1 ORDER BY e.id`,
      [p.id],
    );
    json.entries = entries.rows.map((row) => ({
      id: row.id,
      movementId: row.movement_id,
      movement: row.kind,
      side: row.side,
      minutes: row.minutes,
      bookingId: row.booking_id,
      createdAt: clock.iso(row.created_at),
    }));
  }
  return json;
}

export interface DocumentJson {
  id: string; tenantId: string; kind: string; expiresOn: string;
  perOccurrenceLimit: number | null; additionalInsured: boolean | null;
  contentType: string | null; sizeBytes: number | null; sha256: string | null;
  hasFile: boolean; current: boolean; coverState: string; daysLeft: number | null;
  uploadedAt: string; notices: Array<{ point: string; status: 'queued' | 'sent'; sentAt: string | null }>;
}

export async function renderDocument(tx: Tx, clock: KitchenClock, d: DocumentRow, todayKey: string): Promise<DocumentJson> {
  const newer = await tx.query(
    `SELECT 1 FROM documents WHERE tenant_id=$1 AND kind=$2 AND uploaded_at > $3 LIMIT 1`,
    [d.tenant_id, d.kind, d.uploaded_at],
  );
  const superseded = newer.rows.length > 0;
  const cover = coverState(todayKey, d.expires_on, superseded);
  const notices = await tx.query<{ point: string; status: string; sent_at: number | null }>(
    `SELECT n.point,
       CASE WHEN (SELECT status FROM mail_queue WHERE kind='expiry_notice_'||n.point AND record_id=n.document_id ORDER BY created_at LIMIT 1)='sent' THEN 'sent' ELSE 'queued' END AS status,
       (SELECT sent_at FROM mail_queue WHERE kind='expiry_notice_'||n.point AND record_id=n.document_id ORDER BY created_at LIMIT 1) AS sent_at
     FROM notice_claims n WHERE n.document_id=$1 ORDER BY n.claimed_at`,
    [d.id],
  );
  return {
    id: d.id,
    tenantId: d.tenant_id,
    kind: d.kind,
    expiresOn: d.expires_on,
    perOccurrenceLimit: d.per_occurrence_limit,
    additionalInsured: d.additional_insured,
    contentType: d.content_type,
    sizeBytes: d.size_bytes,
    sha256: d.sha256,
    hasFile: d.has_file,
    current: !superseded,
    coverState: cover.state,
    daysLeft: cover.daysLeft,
    uploadedAt: clock.iso(d.uploaded_at),
    notices: notices.rows.map((row) => ({
      point: row.point,
      status: row.status === 'sent' ? 'sent' as const : 'queued' as const,
      sentAt: row.sent_at === null ? null : clock.iso(row.sent_at),
    })),
  };
}

export function renderInterval(clock: KitchenClock, b: BookingRow, tenantId: string | null, stationNames: Map<string, string>): unknown {
  void tenantId;
  void stationNames;
  return {
    start: clock.iso(b.start),
    end: clock.iso(b.end),
    bufferEnd: clock.iso(b.buffer_end),
  };
}

export function durationOf(minutes: number): string {
  return durationText(minutes);
}
