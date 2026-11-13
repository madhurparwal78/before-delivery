import {
  milestoneSortIndex,
  shotSortIndex,
  type EngagementView,
  type IntakeFileView,
  type InvoiceView,
  type LedgerEntryView,
  type QuoteView,
  type ReviewStill,
  type ReviewView,
  type Service,
  type StudioEngagementView,
} from '../shared/domain.js';
import { MILLIMETRE_FACTOR } from '../shared/format.js';
import { rationalFromDecimalString, rationalScale, rationalToNumber } from '../shared/decimal.js';
import type {
  EngagementRow,
  IntakeFileRow,
  InvoiceLineRow,
  InvoiceRow,
  LedgerRow,
  QuoteLineRowDb,
  StillRow,
} from './db/engagements.js';
import {
  countRevisionRounds,
  listIntakeFiles,
  listInvoiceLines,
  listInvoices,
  listLedger,
  listQuoteLines,
  listStills,
  activeReviewLink,
} from './db/engagements.js';
import { buildQuote, resolvedLine } from './domain/quote.js';
import { rateInEffect, type RateRecord } from './domain/fx.js';
import { config } from './config.js';

export const intakeFileView = (row: IntakeFileRow): IntakeFileView => {
  const isModel = row.kind === 'model';
  const measured = row.dim_x !== null && row.dim_y !== null && row.dim_z !== null;
  const metres = measured
    ? { x: row.dim_x as string, y: row.dim_y as string, z: row.dim_z as string }
    : null;
  const unitForDisplay = row.unit ?? 'as_exported';
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    size_bytes: Number(row.size_bytes),
    status: row.status,
    measurement: isModel ? row.measurement : null,
    needs_unit_confirmation:
      isModel && row.status === 'received' && row.measurement === 'measured' && row.unit === null,
    unit: isModel ? row.unit : null,
    dimensions_m:
      metres === null
        ? null
        : {
            x: Number(metres.x),
            y: Number(metres.y),
            z: Number(metres.z),
          },
    dimensions_mm:
      metres === null
        ? null
        : {
            x: rationalToNumber(
              rationalScale(rationalFromDecimalString(metres.x), MILLIMETRE_FACTOR[unitForDisplay]),
            ),
            y: rationalToNumber(
              rationalScale(rationalFromDecimalString(metres.y), MILLIMETRE_FACTOR[unitForDisplay]),
            ),
            z: rationalToNumber(
              rationalScale(rationalFromDecimalString(metres.z), MILLIMETRE_FACTOR[unitForDisplay]),
            ),
          },
  };
};

export const quoteViewOf = (
  engagement: EngagementRow,
  lines: QuoteLineRowDb[],
  services: readonly Service[],
  rates: readonly RateRecord[],
  now: Date,
): QuoteView =>
  buildQuote({
    currency: engagement.brand_currency,
    revision: engagement.quote_revision,
    rateE4:
      engagement.fx_rate_e4 === null
        ? rateInEffect(rates, engagement.brand_currency, now)
        : BigInt(engagement.fx_rate_e4),
    fxLockedAt: engagement.fx_locked_at,
    lines: lines.map((line) => ({
      shotCode: line.shot_code,
      quantity: line.quantity,
      lockedTitle: line.locked_title,
      lockedPricePence: line.locked_price_pence,
    })),
    services,
  });

const balanceOf = (row: InvoiceRow): bigint =>
  row.status === 'paid' || row.status === 'void' ? 0n : BigInt(row.amount_minor);

export const invoiceView = (row: InvoiceRow, lines: InvoiceLineRow[]): InvoiceView => ({
  id: row.id,
  engagement_id: row.engagement_id,
  milestone: row.milestone,
  number: row.number,
  status: row.status,
  lines: lines.map((line) => ({
    description: line.description,
    amount_minor: Number(line.amount_minor),
  })),
  amount_minor: Number(row.amount_minor),
  balance_minor: Number(balanceOf(row)),
  currency: row.currency,
  killbill_invoice_id: row.killbill_invoice_id,
  failed_attempts: row.failed_attempts,
  issued_at: row.issued_at === null ? null : row.issued_at.toISOString(),
  overdue_at: row.overdue_at === null ? null : row.overdue_at.toISOString(),
});

export const ledgerView = (row: LedgerRow): LedgerEntryView => ({
  id: row.id,
  kind: row.kind,
  amount_minor: Number(row.amount_minor),
  currency: row.currency,
  invoice_id: row.invoice_id,
  killbill_payment_id: row.killbill_payment_id,
  created_at: row.created_at.toISOString(),
});

export type EngagementBundle = {
  engagement: EngagementRow;
  quote: QuoteView;
  files: IntakeFileRow[];
  invoices: { row: InvoiceRow; lines: InvoiceLineRow[] }[];
  ledger: LedgerRow[];
  rounds: { look_dev: number; final_delivery: number };
  stills: StillRow[];
};

export const loadEngagementBundle = async (
  engagement: EngagementRow,
  services: readonly Service[],
  rates: readonly RateRecord[],
): Promise<EngagementBundle> => {
  const [lines, files, invoiceRows, ledger, rounds, stills] = await Promise.all([
    listQuoteLines(engagement.id),
    listIntakeFiles(engagement.id),
    listInvoices(engagement.id),
    listLedger(engagement.id),
    countRevisionRounds(engagement.id),
    listStills(engagement.id),
  ]);
  const invoices = await Promise.all(
    invoiceRows
      .sort((a, b) => milestoneSortIndex(a.milestone) - milestoneSortIndex(b.milestone))
      .map(async (row) => ({ row, lines: await listInvoiceLines(row.id) })),
  );
  return {
    engagement,
    quote: quoteViewOf(engagement, lines, services, rates, new Date()),
    files,
    invoices,
    ledger,
    rounds,
    stills,
  };
};

export const engagementView = (
  bundle: EngagementBundle,
  audience: 'client' | 'studio',
): EngagementView => ({
  id: bundle.engagement.id,
  reference: bundle.engagement.reference,
  title: bundle.engagement.title,
  state: bundle.engagement.state,
  brand: {
    id: bundle.engagement.brand_id,
    name: bundle.engagement.brand_name,
    currency: bundle.engagement.brand_currency,
  },
  quote: bundle.quote,
  files: bundle.files.map(intakeFileView),
  invoices: bundle.invoices
    .filter((entry) => audience === 'studio' || entry.row.issued_at !== null)
    .map((entry) => invoiceView(entry.row, entry.lines)),
  ledger: bundle.ledger.map(ledgerView),
  revision_rounds: bundle.rounds,
});

export const studioEngagementView = async (
  bundle: EngagementBundle,
): Promise<StudioEngagementView> => {
  const link = await activeReviewLink(bundle.engagement.id);
  const live =
    link === null || link.age_seconds > config.reviewLinkTtlSeconds
      ? null
      : {
          expires_at: new Date(
            link.created_at.getTime() + config.reviewLinkTtlSeconds * 1000,
          ).toISOString(),
        };
  return {
    ...engagementView(bundle, 'studio'),
    stills: bundle.stills
      .slice()
      .sort((a, b) => shotSortIndex(a.shot_code) - shotSortIndex(b.shot_code))
      .map((still) => ({ id: still.id, shot_code: still.shot_code, milestone: still.milestone })),
    review_link: live,
  };
};

export const reviewView = (input: {
  engagement: EngagementRow;
  milestone: ReviewView['milestone'];
  roundsUsed: number;
  actionsOpen: boolean;
  stills: StillRow[];
  quoteLines: QuoteLineRowDb[];
  services: readonly Service[];
  token: string;
}): ReviewView => {
  const titleFor = (shotCode: string): string => {
    const line = input.quoteLines.find((entry) => entry.shot_code === shotCode);
    return line === undefined
      ? shotCode
      : resolvedLine(
          {
            shotCode: line.shot_code,
            quantity: line.quantity,
            lockedTitle: line.locked_title,
            lockedPricePence: line.locked_price_pence,
          },
          input.services,
        ).title;
  };
  const stills: ReviewStill[] = input.stills
    .filter((still) => still.milestone === input.milestone)
    .sort((a, b) => shotSortIndex(a.shot_code) - shotSortIndex(b.shot_code))
    .map((still) => ({
      id: still.id,
      shot_code: still.shot_code,
      title: titleFor(still.shot_code),
      url: `/api/review/${input.token}/stills/${still.id}`,
    }));
  return {
    reference: input.engagement.reference,
    brand_name: input.engagement.brand_name,
    milestone: input.milestone,
    state: input.engagement.state,
    revision_rounds_used: input.roundsUsed,
    revision_rounds_included: 2,
    actions_open: input.actionsOpen,
    stills,
  };
};
