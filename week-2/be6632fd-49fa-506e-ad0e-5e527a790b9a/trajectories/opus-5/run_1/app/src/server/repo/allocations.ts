import { query } from '../db/pool.ts';
import { STATUS_COPY } from '../../domain/copy.ts';
import { marketCity, marketCurrency, type Currency, type Market } from '../../domain/markets.ts';
import type { PriceListRow } from '../../domain/pricing.ts';
import { formatInstant } from '../../domain/time.ts';

export type AllocationStatus = 'requested' | 'split' | 'confirmed';

export interface AllocationLineRecord {
  styleNumber: string;
  styleName: string;
  position: number;
  requestedQuantity: number;
  allocatedQuantity: number;
  unitPriceMinor: number | null;
  netMinor: number | null;
  vatMinor: number | null;
  lineTotalMinor: number | null;
}

export interface AllocationRecord {
  id: string;
  workspaceId: string;
  dropId: string;
  dropName: string;
  stockistId: string;
  stockistName: string;
  market: Market;
  currency: Currency;
  status: AllocationStatus;
  version: number;
  requestedAtMs: number;
  internalNote: string;
  savedBy: string;
  savedAtMs: number;
  confirmedAtMs: number | null;
  priceListEffectiveDate: string | null;
  invoiceNumber: string | null;
  killbillInvoiceId: string | null;
  totalMinor: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactErased: boolean;
  lines: AllocationLineRecord[];
}

interface AllocationRow {
  id: string;
  workspace_id: string;
  drop_id: string;
  drop_name: string;
  stockist_id: string;
  stockist_name: string;
  market: Market;
  status: AllocationStatus;
  version: number;
  requested_at_ms: number;
  internal_note: string;
  saved_by: string;
  saved_at_ms: number;
  confirmed_at_ms: number | null;
  price_list_effective_date: string | null;
  invoice_number: string | null;
  killbill_invoice_id: string | null;
  total_minor: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_erased: boolean;
}

interface LineRow {
  allocation_id: string;
  style_number: string;
  style_name: string | null;
  position: number;
  requested_quantity: number;
  allocated_quantity: number;
  unit_price_minor: number | null;
  net_minor: number | null;
  vat_minor: number | null;
  line_total_minor: number | null;
}

const SELECT = `
  select a.*, d.name as drop_name, s.name as stockist_name, s.market,
         s.contact_name, s.contact_email, s.contact_erased
    from allocations a
    join drops d on d.id = a.drop_id
    join stockists s on s.id = a.stockist_id`;

/** Archiving a stockist hides its allocations from every list and lookup. */
const ACTIVE_STOCKIST = `s.status = 'active'`;

export async function loadAllocations(
  where: string,
  values: readonly unknown[],
): Promise<AllocationRecord[]> {
  const rows = await query<AllocationRow>(
    `${SELECT} where ${ACTIVE_STOCKIST} and ${where} order by a.requested_at_ms`,
    values,
  );
  if (rows.length === 0) return [];
  const lines = await query<LineRow>(
    `select al.*, ds.name as style_name
       from allocation_lines al
       left join allocations a on a.id = al.allocation_id
       left join drop_styles ds on ds.drop_id = a.drop_id and ds.style_number = al.style_number
      where al.allocation_id = any($1)
      order by al.position`,
    [rows.map((row) => row.id)],
  );

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    dropId: row.drop_id,
    dropName: row.drop_name,
    stockistId: row.stockist_id,
    stockistName: row.stockist_name,
    market: row.market,
    currency: marketCurrency(row.market),
    status: row.status,
    version: row.version,
    requestedAtMs: Number(row.requested_at_ms),
    internalNote: row.internal_note,
    savedBy: row.saved_by,
    savedAtMs: Number(row.saved_at_ms),
    confirmedAtMs: row.confirmed_at_ms === null ? null : Number(row.confirmed_at_ms),
    priceListEffectiveDate: row.price_list_effective_date,
    invoiceNumber: row.invoice_number,
    killbillInvoiceId: row.killbill_invoice_id,
    totalMinor: row.total_minor === null ? null : Number(row.total_minor),
    contactName: row.contact_erased ? STATUS_COPY.erasedContact : row.contact_name,
    contactEmail: row.contact_erased ? null : row.contact_email,
    contactErased: row.contact_erased,
    lines: lines
      .filter((line) => line.allocation_id === row.id)
      .map((line) => ({
        styleNumber: line.style_number,
        styleName: line.style_name ?? '',
        position: line.position,
        requestedQuantity: line.requested_quantity,
        allocatedQuantity: line.allocated_quantity,
        unitPriceMinor: line.unit_price_minor === null ? null : Number(line.unit_price_minor),
        netMinor: line.net_minor === null ? null : Number(line.net_minor),
        vatMinor: line.vat_minor === null ? null : Number(line.vat_minor),
        lineTotalMinor: line.line_total_minor === null ? null : Number(line.line_total_minor),
      })),
  }));
}

export async function loadAllocationById(
  id: string,
  workspaceId: string,
): Promise<AllocationRecord | null> {
  const rows = await loadAllocations('a.id = $1 and a.workspace_id = $2', [id, workspaceId]);
  return rows[0] ?? null;
}

function lineShape(line: AllocationLineRecord): Record<string, unknown> {
  return {
    styleNumber: line.styleNumber,
    styleName: line.styleName,
    requestedQuantity: line.requestedQuantity,
    allocatedQuantity: line.allocatedQuantity,
    unitPriceMinor: line.unitPriceMinor,
    netMinor: line.netMinor,
    vatMinor: line.vatMinor,
    lineTotalMinor: line.lineTotalMinor,
  };
}

export function allocationShape(record: AllocationRecord): Record<string, unknown> {
  return {
    id: record.id,
    dropId: record.dropId,
    dropName: record.dropName,
    stockistId: record.stockistId,
    stockistName: record.stockistName,
    market: record.market,
    currency: record.currency,
    status: record.status,
    version: record.version,
    requestedAt: formatInstant(record.requestedAtMs),
    lines: record.lines.map(lineShape),
    totalMinor: record.totalMinor,
    priceListEffectiveDate: record.priceListEffectiveDate,
    invoiceNumber: record.invoiceNumber,
    killbillInvoiceId: record.killbillInvoiceId,
    contactName: record.contactName,
    internalNote: record.internalNote,
    savedBy: record.savedBy,
    savedAt: formatInstant(record.savedAtMs),
    confirmedAt: record.confirmedAtMs === null ? null : formatInstant(record.confirmedAtMs),
  };
}

/** Exactly the fields a stockist buyer may read. */
export function buyerAllocationShape(record: AllocationRecord): Record<string, unknown> {
  return {
    id: record.id,
    dropName: record.dropName,
    stockistName: record.stockistName,
    status: record.status,
    currency: record.currency,
    lines: record.lines.map(lineShape),
    totalMinor: record.totalMinor,
    priceListEffectiveDate: record.priceListEffectiveDate,
    invoiceNumber: record.invoiceNumber,
    confirmedAt: record.confirmedAtMs === null ? null : formatInstant(record.confirmedAtMs),
  };
}

export function allocationCity(record: AllocationRecord): string {
  return marketCity(record.market);
}

export async function loadPriceRows(workspaceId: string): Promise<PriceListRow[]> {
  const rows = await query<{
    list_id: string;
    effective_date: string;
    created_at_ms: number;
    style_number: string;
    currency: Currency;
    unit_price_minor: number;
  }>(
    `select pl.id as list_id, pl.effective_date, pl.created_at_ms,
            p.style_number, p.currency, p.unit_price_minor
       from price_lists pl join price_list_prices p on p.price_list_id = pl.id
      where pl.workspace_id = $1`,
    [workspaceId],
  );
  return rows.map((row) => ({
    listId: row.list_id,
    effectiveDate: row.effective_date,
    createdAtMs: Number(row.created_at_ms),
    styleNumber: row.style_number,
    currency: row.currency,
    unitPriceMinor: Number(row.unit_price_minor),
  }));
}
