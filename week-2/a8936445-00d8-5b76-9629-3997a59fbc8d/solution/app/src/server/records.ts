// Row types, loaders scoped to the caller's tenant, and serializers to the brief's published fields.
import type { Booking, ComplianceDocument, Invoice, InvoiceLine, Tenant } from "../shared/api";
import type { BookingStatus, DocumentKind, DocumentStatus, InvoiceStatus, PayWith } from "../shared/kitchen";
import { hhmm, kitchenIso, kitchenParts } from "../shared/time";
import { one, rows, type Queryable } from "./db";
import { notFound } from "./errors";
import type { SessionUser } from "./sessions";
import { documentValid, requiredDocuments, taxRatePercent, tenantStatus, type Lifecycle, type RequiredDocuments } from "./rules";

export const kitchenToday = (nowMs: number): string => kitchenParts(nowMs).date;
const iso = (value: Date | null): string | null => (value ? kitchenIso(value.getTime()) : null);

/** Tenant users reach only their own tenant; anything else is the same not found as an unknown ID. */
export function ownedBy(user: SessionUser, tenantId: string): boolean {
  return user.role === "operator" || user.tenant_id === tenantId;
}

/* ---------- Tenants ---------- */

export interface TenantRow {
  id: string;
  business_name: string;
  lifecycle: Lifecycle;
  owner_name: string;
  owner_email: string;
}

export interface DocumentRow {
  id: string;
  tenant_id: string;
  kind: DocumentKind;
  holder_name: string | null;
  expires_on: string;
  status: DocumentStatus;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  file_pending: boolean;
  uploaded_at: Date;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  reminder_queued_at: Date | null;
}

const TENANT_SELECT = `SELECT t.id, t.business_name, t.lifecycle, u.name AS owner_name, u.email AS owner_email
  FROM tenants t JOIN users u ON u.tenant_id = t.id AND u.role = 'owner'`;

export async function tenantRows(db: Queryable, id?: string): Promise<TenantRow[]> {
  return id === undefined
    ? rows<TenantRow>(db, `${TENANT_SELECT} ORDER BY t.business_name`)
    : rows<TenantRow>(db, `${TENANT_SELECT} WHERE t.id = $1`, [id]);
}

export async function loadTenant(db: Queryable, user: SessionUser, id: string): Promise<TenantRow> {
  const [tenant] = await tenantRows(db, id);
  if (!tenant || !ownedBy(user, tenant.id)) throw notFound();
  return tenant;
}

export async function tenantDocuments(db: Queryable, tenantId: string): Promise<DocumentRow[]> {
  return rows<DocumentRow>(db, "SELECT * FROM documents WHERE tenant_id = $1 ORDER BY uploaded_at DESC, id", [tenantId]);
}

export interface TenantStanding {
  required: RequiredDocuments;
  status: Tenant["status"];
}

/** Validity and status are worked out at each request from the approved documents. */
export async function tenantStanding(db: Queryable, tenant: TenantRow, nowMs: number): Promise<TenantStanding> {
  const required = requiredDocuments(await tenantDocuments(db, tenant.id), kitchenToday(nowMs));
  return { required, status: tenantStatus(tenant.lifecycle, required) };
}

export async function hourBalance(db: Queryable, tenantId: string): Promise<number> {
  const row = await one<{ balance: number }>(db, "SELECT COALESCE(SUM(minutes), 0)::bigint AS balance FROM ledger_entries WHERE tenant_id = $1 AND account = 'tenant_pack'", [tenantId]);
  return (row as { balance: number }).balance;
}

export async function tenantView(db: Queryable, tenant: TenantRow, nowMs: number): Promise<Tenant> {
  const standing = await tenantStanding(db, tenant, nowMs);
  const shelves = await rows<{ id: string }>(db, "SELECT id FROM shelves WHERE tenant_id = $1 ORDER BY position", [tenant.id]);
  return {
    id: tenant.id,
    business_name: tenant.business_name,
    status: standing.status,
    owner_name: tenant.owner_name,
    owner_email: tenant.owner_email,
    required_documents: standing.required,
    shelves: shelves.map((s) => s.id),
    hour_balance_minutes: await hourBalance(db, tenant.id),
  };
}

/* ---------- Bookings ---------- */

export interface BookingRow {
  id: string;
  ref: string;
  hold_ref: string;
  tenant_id: string;
  station_id: string;
  date: string;
  start_minute: number;
  end_minute: number;
  start_at: Date;
  end_at: Date;
  status: BookingStatus;
  pay_with: PayWith | null;
  amount_cents: number | null;
  policy_version: number | null;
  notes: string;
  checked_in_at: Date | null;
  checked_out_at: Date | null;
  holdover_reported_minutes: number | null;
  holdover_billed_minutes: number | null;
  holdover_amount_cents: number | null;
  cancelled_at: Date | null;
  cancel_late: boolean | null;
  fee_cents: number | null;
  fee_minutes: number | null;
  fee_refunded: boolean | null;
  fee_invoice_id: string | null;
  created_at: Date;
  free_window_hours: number | null;
  late_fee_percent: number | null;
  tenant_name: string;
  owner_email: string;
  station_name: string;
  hourly_rate_cents: number;
  elapsed_minutes: number;
}

export const BOOKING_SELECT = `SELECT b.*, p.free_window_hours, p.late_fee_percent, t.business_name AS tenant_name,
    o.email AS owner_email, s.name AS station_name, s.hourly_rate_cents,
    (EXTRACT(EPOCH FROM (b.end_at - b.start_at)) / 60)::integer AS elapsed_minutes
  FROM bookings b
  JOIN tenants t ON t.id = b.tenant_id
  JOIN users o ON o.tenant_id = b.tenant_id AND o.role = 'owner'
  JOIN stations s ON s.id = b.station_id
  LEFT JOIN policy_versions p ON p.version = b.policy_version`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID.test(value);

export async function loadBooking(db: Queryable, user: SessionUser, id: string, forUpdate = false): Promise<BookingRow> {
  if (!isUuid(id)) throw notFound();
  const booking = await one<BookingRow>(db, `${BOOKING_SELECT} WHERE b.id = $1${forUpdate ? " FOR UPDATE OF b" : ""}`, [id]);
  if (!booking || !ownedBy(user, booking.tenant_id)) throw notFound();
  return booking;
}

export function bookingView(b: BookingRow, user: SessionUser): Booking {
  const view: Booking = {
    id: b.id,
    ref: b.ref,
    hold_ref: b.hold_ref,
    tenant_id: b.tenant_id,
    station_id: b.station_id,
    date: b.date,
    start_local: hhmm(b.start_minute),
    end_local: hhmm(b.end_minute),
    start: kitchenIso(b.start_at.getTime()),
    end: kitchenIso(b.end_at.getTime()),
    elapsed_minutes: b.elapsed_minutes,
    status: b.status,
    pay_with: b.pay_with,
    amount_cents: b.pay_with === "account" ? b.amount_cents : null,
    policy:
      b.policy_version === null
        ? null
        : { version: b.policy_version, free_window_hours: b.free_window_hours as number, late_fee_percent: b.late_fee_percent as number },
    notes: b.notes,
    checked_in_at: iso(b.checked_in_at),
    checked_out_at: iso(b.checked_out_at),
    holdover:
      b.holdover_reported_minutes === null
        ? null
        : { reported_minutes: b.holdover_reported_minutes, billed_minutes: b.holdover_billed_minutes as number, amount_cents: b.holdover_amount_cents as number },
    cancellation:
      b.cancelled_at === null
        ? null
        : {
            cancelled_at: kitchenIso(b.cancelled_at.getTime()),
            late: b.cancel_late as boolean,
            fee_cents: b.fee_cents as number,
            fee_minutes: b.fee_minutes as number,
            fee_refunded: b.fee_refunded as boolean,
          },
    created_at: kitchenIso(b.created_at.getTime()),
  };
  if (user.role === "operator") view.tenant_name = b.tenant_name;
  return view;
}

/* ---------- Documents ---------- */

export async function loadDocument(db: Queryable, user: SessionUser, id: string): Promise<DocumentRow> {
  if (!isUuid(id)) throw notFound();
  const doc = await one<DocumentRow>(db, "SELECT * FROM documents WHERE id = $1", [id]);
  if (!doc || !ownedBy(user, doc.tenant_id)) throw notFound();
  return doc;
}

export function documentView(d: DocumentRow, nowMs: number): ComplianceDocument {
  return {
    id: d.id,
    tenant_id: d.tenant_id,
    kind: d.kind,
    holder_name: d.holder_name,
    expires_on: d.expires_on,
    status: d.status,
    valid: documentValid(d, kitchenToday(nowMs)),
    file_name: d.file_name,
    content_type: d.content_type,
    size_bytes: d.size_bytes,
    uploaded_at: kitchenIso(d.uploaded_at.getTime()),
    reviewed_at: iso(d.reviewed_at),
    rejection_reason: d.rejection_reason,
  };
}

/* ---------- Invoices ---------- */

export interface InvoiceRow {
  id: string;
  number: string;
  tenant_id: string;
  period: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  subtotal_cents: number;
  tax_rate_basis_points: number;
  tax_cents: number;
  total_cents: number;
  issued_at: Date;
  paid_at: Date | null;
}

export async function loadInvoice(db: Queryable, user: SessionUser, id: string, forUpdate = false): Promise<InvoiceRow> {
  if (!isUuid(id)) throw notFound();
  const invoice = await one<InvoiceRow>(db, `SELECT * FROM invoices WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  if (!invoice || !ownedBy(user, invoice.tenant_id)) throw notFound();
  return invoice;
}

export async function taxBasisPoints(db: Queryable): Promise<number> {
  const kitchen = (await one<{ tax_rate_basis_points: number }>(db, "SELECT tax_rate_basis_points FROM kitchen WHERE id = 1")) as { tax_rate_basis_points: number };
  return kitchen.tax_rate_basis_points;
}

export function invoiceView(i: InvoiceRow): Invoice {
  return {
    id: i.id,
    number: i.number,
    tenant_id: i.tenant_id,
    period: i.period,
    status: i.status,
    lines: i.lines,
    subtotal_cents: i.subtotal_cents,
    tax_rate_percent: taxRatePercent(i.tax_rate_basis_points),
    tax_cents: i.tax_cents,
    total_cents: i.total_cents,
    issued_at: kitchenIso(i.issued_at.getTime()),
    paid_at: iso(i.paid_at),
  };
}
