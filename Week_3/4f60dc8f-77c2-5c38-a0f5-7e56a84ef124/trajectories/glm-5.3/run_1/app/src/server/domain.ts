import { randomUUID, createHash, randomBytes } from 'node:crypto';
import type { Pool } from './db';
import type { App } from './app';
import { ApiError } from './errors';
import type {
  Engagement, EngagementState, IntakeFile, Invoice, InvoiceStatus, LedgerEntry,
  Milestone, Quote, CurrencyCode, ExportUnit, MeasurementStatus, FileKind,
} from './types';
import {
  CURRENCIES, convertGbpMinor, milestoneSplit, vatAmount, decimalFromString,
  decimalToString, divideDecimal, decimalFromInt, formatMoney, isCurrency,
} from './money';
import type { Decimal } from './money';

export function newId(): string {
  return randomUUID();
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** The unit scale decided in exactly one place. */
export const UNIT_SCALES: Record<ExportUnit, number> = {
  as_exported: 1,
  mm: 0.001,
  cm: 0.01,
  in: 0.0254,
};

/** The largest dimension over 5 m or under 5 mm needs a unit decision. */
export function needsUnitDecision(dims: { x: number; y: number; z: number }): boolean {
  const largest = Math.max(dims.x, dims.y, dims.z);
  return largest > 5 || largest < 0.005;
}

export function derivedDimensionsMm(dims: { x: number; y: number; z: number }, unit: ExportUnit): { x: number; y: number; z: number } {
  const scale = UNIT_SCALES[unit] * 1000;
  return { x: dims.x * scale, y: dims.y * scale, z: dims.z * scale };
}

/** The readout format: mm to one decimal, inches to two, rounded half up. */
export function formatReadout(mm: { x: number; y: number; z: number }): { mm: string; inches: string } {
  const oneDecimal = (value: number): string => {
    const scaled = Math.round(value * 10 + Number.EPSILON * 10) / 10;
    const fixed = scaled.toFixed(1);
    return fixed;
  };
  const twoDecimals = (value: number): string => {
    const scaled = Math.round(value * 100 + Number.EPSILON * 100) / 100;
    return scaled.toFixed(2);
  };
  const inches = {
    x: mm.x / 25.4,
    y: mm.y / 25.4,
    z: mm.z / 25.4,
  };
  return {
    mm: `${oneDecimal(mm.x)} × ${oneDecimal(mm.y)} × ${oneDecimal(mm.z)} mm`,
    inches: `${twoDecimals(inches.x)} × ${twoDecimals(inches.y)} × ${twoDecimals(inches.z)} in`,
  };
}

export function formatMetres(dims: { x: number; y: number; z: number }): string {
  return `${dims.x.toFixed(3)} × ${dims.y.toFixed(3)} × ${dims.z.toFixed(3)} m`;
}

/** The rate in effect: latest effective_at not after the moment; ties go to the later-created rate. */
export async function rateInEffect(pool: Pool, currency: Exclude<CurrencyCode, 'GBP'>, moment: Date = new Date()): Promise<string> {
  const result = await pool.query(
    `SELECT rate, effective_at, created_at FROM fx_rates
     WHERE currency = $1 AND effective_at <= $2
     ORDER BY effective_at DESC, created_at DESC, id DESC
     LIMIT 1`,
    [currency, moment.toISOString()],
  );
  if (result.rows.length === 0) {
    throw new ApiError('validation_failed', { rate: 'Enter a rate between 0.0001 and 1000 with up to four decimals.' });
  }
  return result.rows[0].rate as string;
}

export async function allRatesInEffect(pool: Pool, moment: Date = new Date()): Promise<Record<'EUR' | 'USD' | 'JPY', string>> {
  const [eur, usd, jpy] = await Promise.all([
    rateInEffect(pool, 'EUR', moment),
    rateInEffect(pool, 'USD', moment),
    rateInEffect(pool, 'JPY', moment),
  ]);
  return { EUR: eur, USD: usd, JPY: jpy };
}

export interface ServiceInfo {
  code: string;
  title: string;
  list_price_pence: number;
  azimuth_deg: number;
  elevation_deg: number;
  sort: number;
}

export async function loadServices(app: App): Promise<ServiceInfo[]> {
  const services = await app.pocketbase.getServices();
  if (services.length === 0) {
    throw new ApiError('content_unavailable');
  }
  return services.map(service => ({
    code: service.code,
    title: service.title,
    list_price_pence: service.list_price_pence,
    azimuth_deg: service.azimuth_deg,
    elevation_deg: service.elevation_deg,
    sort: service.sort,
  }));
}

export interface EngagementRow {
  id: string;
  brand_id: string;
  brand_name: string;
  brand_currency: CurrencyCode;
  reference: string;
  title: string;
  state: EngagementState;
  revision: number;
  fx_rate: string;
  fx_locked_at: Date | null;
  quote_locked: boolean;
  finals_out: boolean;
  rounds_look_dev: number;
  rounds_final_delivery: number;
  created_at: Date;
}

export async function loadEngagementRow(pool: Pool, engagementId: string): Promise<EngagementRow | null> {
  const result = await pool.query(
    `SELECT e.id, e.brand_id, b.name AS brand_name, b.currency AS brand_currency,
            e.reference, e.title, e.state, e.revision, e.fx_rate, e.fx_locked_at,
            e.quote_locked, e.finals_out, e.rounds_look_dev, e.rounds_final_delivery, e.created_at
     FROM engagements e JOIN brands b ON b.id = e.brand_id
     WHERE e.id = $1`,
    [engagementId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    brand_id: row.brand_id,
    brand_name: row.brand_name,
    brand_currency: row.brand_currency,
    reference: row.reference,
    title: row.title,
    state: row.state,
    revision: row.revision,
    fx_rate: row.fx_rate,
    fx_locked_at: row.fx_locked_at,
    quote_locked: row.quote_locked,
    finals_out: row.finals_out,
    rounds_look_dev: row.rounds_look_dev,
    rounds_final_delivery: row.rounds_final_delivery,
    created_at: row.created_at,
  };
}

/** Build the quote for an engagement: conversion, VAT, split, title and price lock. */
export async function buildQuote(app: App, row: EngagementRow): Promise<Quote> {
  const services = await loadServices(app);
  const serviceByCode = new Map(services.map(service => [service.code, service]));
  const linesResult = await app.pool.query(
    `SELECT shot_code, quantity, locked_title, locked_price_pence FROM quote_lines WHERE engagement_id = $1`,
    [row.id],
  );
  const sortedCodes = services.map(service => service.code);
  const lines = sortedCodes
    .filter(code => linesResult.rows.some(line => line.shot_code === code))
    .map(code => {
      const line = linesResult.rows.find(l => l.shot_code === code) as { shot_code: string; quantity: number; locked_title: string | null; locked_price_pence: number | null };
      const service = serviceByCode.get(code) as ServiceInfo;
      const locked = row.quote_locked;
      const title = locked && line.locked_title ? line.locked_title : service.title;
      const pricePence = locked && line.locked_price_pence !== null ? line.locked_price_pence : service.list_price_pence;
      const amountMinor = convertGbpMinor(pricePence * line.quantity, row.fx_rate, row.brand_currency);
      return {
        shot_code: code,
        title,
        quantity: line.quantity,
        unit_price_gbp_minor: pricePence,
        amount_minor: Number(amountMinor),
      };
    });

  const subtotal = lines.reduce((sum, line) => sum + BigInt(line.amount_minor), 0n);
  const vat = vatAmount(subtotal, row.brand_currency);
  const total = subtotal + vat;
  const split = milestoneSplit(total);
  const currency = row.brand_currency;
  return {
    currency,
    exponent: CURRENCIES[currency].exponent,
    revision: row.revision,
    fx_rate: row.fx_rate,
    fx_locked: row.fx_locked_at !== null,
    fx_locked_at: row.fx_locked_at ? row.fx_locked_at.toISOString() : null,
    lines,
    subtotal_minor: Number(subtotal),
    vat_minor: Number(vat),
    total_minor: Number(total),
    milestones: {
      deposit_minor: Number(split.deposit),
      look_dev_minor: Number(split.lookDev),
      final_delivery_minor: Number(split.finalDelivery),
    },
  };
}

export function serializeIntakeFile(row: Record<string, unknown>): IntakeFile {
  const dimsM = row.dim_m_x !== null && row.dim_m_y !== null && row.dim_m_z !== null
    ? { x: Number(row.dim_m_x), y: Number(row.dim_m_y), z: Number(row.dim_m_z) }
    : null;
  const unit = row.unit as ExportUnit | null;
  const unitNeeded = row.unit_needed === true;
  const unitConfirmed = row.unit_confirmed === true;
  const measurement = row.measurement as MeasurementStatus | null;
  let dimsMm: { x: number; y: number; z: number } | null = null;
  if (dimsM && measurement === 'measured' && unit && unitConfirmed) {
    dimsMm = derivedDimensionsMm(dimsM, unit);
  } else if (dimsM && measurement === 'measured' && !unitNeeded) {
    dimsMm = derivedDimensionsMm(dimsM, 'as_exported');
  }
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as FileKind,
    size_bytes: Number(row.size_bytes),
    status: row.status as 'received' | 'superseded',
    measurement: measurement ?? null,
    needs_unit_confirmation: measurement === 'measured' && unitNeeded && !unitConfirmed,
    unit,
    dimensions_m: dimsM,
    dimensions_mm: dimsMm,
  };
}

export async function loadFiles(pool: Pool, engagementId: string): Promise<IntakeFile[]> {
  const result = await pool.query(
    `SELECT * FROM intake_files WHERE engagement_id = $1 ORDER BY created_at ASC, id ASC`,
    [engagementId],
  );
  return result.rows.map(row => serializeIntakeFile(row));
}

export function serializeInvoice(row: Record<string, unknown>, lines: { description: string; amount_minor: number }[]): Invoice {
  return {
    id: String(row.id),
    engagement_id: String(row.engagement_id),
    milestone: row.milestone as Milestone,
    number: row.number === null || row.number === undefined ? null : String(row.number),
    status: row.status as InvoiceStatus,
    lines,
    amount_minor: Number(row.amount_minor),
    balance_minor: Number(row.balance_minor),
    currency: row.currency as CurrencyCode,
    killbill_invoice_id: row.killbill_invoice_id === null || row.killbill_invoice_id === undefined ? null : String(row.killbill_invoice_id),
    failed_attempts: Number(row.failed_attempts),
    issued_at: row.issued_at ? new Date(row.issued_at as string | Date).toISOString() : null,
    overdue_at: row.overdue_at ? new Date(row.overdue_at as string | Date).toISOString() : null,
  };
}

export async function loadInvoices(pool: Pool, engagementId: string, onlyIssued: boolean, currency: CurrencyCode): Promise<Invoice[]> {
  const result = await pool.query(
    `SELECT i.*, COUNT(l.id) AS line_count
     FROM invoices i LEFT JOIN invoice_lines l ON l.invoice_id = i.id
     WHERE i.engagement_id = $1 ${onlyIssued ? 'AND i.issued_at IS NOT NULL' : ''}
     GROUP BY i.id`,
    [engagementId],
  );
  const ids = result.rows.map(row => row.id);
  const linesByInvoice = new Map<string, { description: string; amount_minor: number }[]>();
  if (ids.length > 0) {
    const linesResult = await pool.query(
      `SELECT id, invoice_id, description, amount_minor FROM invoice_lines WHERE invoice_id = ANY($1) ORDER BY created_at ASC, id ASC`,
      [ids],
    );
    for (const line of linesResult.rows) {
      const list = linesByInvoice.get(line.invoice_id) ?? [];
      list.push({ description: line.description, amount_minor: Number(line.amount_minor) });
      linesByInvoice.set(line.invoice_id, list);
    }
  }
  const order: Record<Milestone, number> = { deposit: 0, look_dev: 1, final_delivery: 2 };
  return result.rows
    .map(row => {
      row.currency = currency;
      return serializeInvoice(row, linesByInvoice.get(row.id) ?? []);
    })
    .sort((a, b) => order[a.milestone] - order[b.milestone]);
}

export function serializeLedger(row: Record<string, unknown>): LedgerEntry {
  return {
    id: String(row.id),
    kind: row.kind as 'deposit' | 'invoice_payment' | 'refund',
    amount_minor: Number(row.amount_minor),
    currency: row.currency as CurrencyCode,
    invoice_id: row.invoice_id === null || row.invoice_id === undefined ? null : String(row.invoice_id),
    killbill_payment_id: String(row.killbill_payment_id),
    created_at: new Date(row.created_at as string | Date).toISOString(),
  };
}

export async function loadLedger(pool: Pool, engagementId: string): Promise<LedgerEntry[]> {
  const result = await pool.query(
    `SELECT * FROM ledger_entries WHERE engagement_id = $1 ORDER BY created_at ASC, id ASC`,
    [engagementId],
  );
  return result.rows.map(row => serializeLedger(row));
}

export async function loadEngagement(app: App, engagementId: string, options: { onlyIssuedInvoices?: boolean } = {}): Promise<Engagement | null> {
  const row = await loadEngagementRow(app.pool, engagementId);
  if (row === null) {
    return null;
  }
  const quote = await buildQuote(app, row);
  const files = await loadFiles(app.pool, engagementId);
  const invoices = await loadInvoices(app.pool, engagementId, options.onlyIssuedInvoices ?? true, row.brand_currency);
  const ledger = await loadLedger(app.pool, engagementId);
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    state: row.state,
    brand: { id: row.brand_id, name: row.brand_name, currency: row.brand_currency },
    quote,
    files,
    invoices,
    ledger,
    revision_rounds: { look_dev: row.rounds_look_dev, final_delivery: row.rounds_final_delivery },
  };
}

/** The landing path rule in one place. */
export function landingPath(next: string | undefined): string {
  if (typeof next !== 'string' || next.length === 0 || !next.startsWith('/') || next.length < 2) {
    return '/account';
  }
  const second = next[1];
  if (second === '/' || second === '\\') {
    return '/account';
  }
  if (/:\/\//.test(next)) {
    return '/account';
  }
  return next;
}

/** Format a UTC date like 2 November 2026. */
export function formatUtcDate(date: Date): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Format UTC hours and minutes in 24-hour form, like 14:05. */
export function formatUtcTime(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function quoteFxLine(quote: Quote): string {
  const rate = decimalFromString(quote.fx_rate) as Decimal;
  const rateText = decimalToString(rate, 4);
  if (quote.currency === 'GBP') {
    return 'Priced in GBP.';
  }
  if (quote.fx_locked && quote.fx_locked_at) {
    const lockedDate = formatUtcDate(new Date(quote.fx_locked_at));
    return `Locked at ${rateText} per £1 on ${lockedDate}.`;
  }
  return `Indicative at ${rateText} per £1.`;
}

export function formatInvoiceAmount(amountMinor: number, currency: CurrencyCode): string {
  return formatMoney(amountMinor, currency);
}

export function isRate(value: string): boolean {
  const parsed = decimalFromString(value);
  if (parsed === null) {
    return false;
  }
  if (parsed.scale > 4) {
    return false;
  }
  const min = decimalFromString('0.0001') as Decimal;
  const max = decimalFromString('1000') as Decimal;
  const scaledMin = { digits: min.digits * 10n ** BigInt(Math.max(0, parsed.scale - min.scale)), scale: Math.max(parsed.scale, min.scale) };
  const scaledMax = { digits: max.digits * 10n ** BigInt(Math.max(0, parsed.scale - max.scale)), scale: Math.max(parsed.scale, max.scale) };
  return !(parsed.digits < scaledMin.digits) && !(parsed.digits > scaledMax.digits);
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return isCurrency(value);
}

/** Round-half-up at an arbitrary scale for the readout display. */
export function roundHalfUpNumber(value: number, places: number): number {
  const factor = 10 ** places;
  const epsilon = value < 0 ? -Number.EPSILON : Number.EPSILON;
  return Math.round(value * factor + epsilon * factor) / factor;
}

export function exponentFor(currency: CurrencyCode): number {
  return CURRENCIES[currency].exponent;
}

export function divideAt(denominator: number, numerator: number, scale: number): Decimal {
  return divideDecimal(decimalFromInt(numerator), decimalFromInt(denominator), scale);
}
