import { requireRole, requireSession } from '../auth.ts';
import { LIMITS } from '../config.ts';
import { transact } from '../db/pool.ts';
import { FIELD_COPY, STATUS_COPY } from '../../domain/copy.ts';
import { matchKey, parseLegacyLineSheet } from '../../domain/linesheet.ts';
import { isCurrency, type Currency } from '../../domain/markets.ts';
import { priceInForce } from '../../domain/pricing.ts';
import { csvDocument } from '../../domain/text.ts';
import { copenhagenToday } from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { ApiError, tooLarge, unsupportedMediaType, validationFailed } from '../http/errors.ts';
import { PartTooLarge, readMultipart } from '../http/multipart.ts';
import { sendJson, sendText } from '../http/respond.ts';
import { loadPriceRows } from '../repo/allocations.ts';
import { requireAllocation } from './allocations.ts';
import { requireDrop } from './drops.ts';

const DROP_HEADER = [
  'Style number',
  'Name',
  'Colour',
  'Wholesale edition',
  'RRP DKK (minor units)',
  'Wholesale price (minor units)',
  'Currency',
  'Price list from',
];

const ALLOCATION_HEADER = [
  'Style number',
  'Name',
  'Quantity',
  'Unit price (minor units)',
  'Net (minor units)',
  'VAT (minor units)',
  'Line total (minor units)',
  'Currency',
  'Price list from',
];

export async function exportDropLineSheet(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'merchandiser', 'launch_producer', 'finance_lead', 'press_lead');

  const currencyParam = ctx.query('currency') ?? 'DKK';
  if (!isCurrency(currencyParam)) throw validationFailed({ currency: FIELD_COPY.required });
  const currency = currencyParam as Currency;
  const onDate = copenhagenToday(ctx.nowMs);
  const rows = await loadPriceRows(session.workspaceId);

  const body = csvDocument([
    DROP_HEADER,
    ...drop.styles.map((style) => {
      const price = priceInForce(rows, style.styleNumber, currency, onDate);
      return [
        style.styleNumber,
        style.name,
        style.colour,
        String(style.wholesaleEdition),
        String(style.rrpDkkMinor),
        price === null ? '' : String(price.unitPriceMinor),
        currency,
        price === null ? '' : price.effectiveDate,
      ];
    }),
  ]);
  sendText(ctx.response, 200, 'text/csv; charset=utf-8', body, {
    'content-disposition': `attachment; filename="line-sheet-${drop.slug}.csv"`,
  });
}

export async function exportAllocationLineSheet(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const allocation = await requireAllocation(ctx, session);

  const body = csvDocument([
    ALLOCATION_HEADER,
    ...allocation.lines.map((line) => [
      line.styleNumber,
      line.styleName,
      String(line.allocatedQuantity),
      line.unitPriceMinor === null ? '' : String(line.unitPriceMinor),
      line.netMinor === null ? '' : String(line.netMinor),
      line.vatMinor === null ? '' : String(line.vatMinor),
      line.lineTotalMinor === null ? '' : String(line.lineTotalMinor),
      allocation.currency,
      allocation.priceListEffectiveDate ?? '',
    ]),
  ]);
  sendText(ctx.response, 200, 'text/csv; charset=utf-8', body, {
    'content-disposition': `attachment; filename="allocation-${allocation.id}.csv"`,
  });
}

interface MergeReport {
  styleNumber: string;
  lines: number[];
}

export async function importLineSheet(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'merchandiser');

  let file;
  try {
    const multipart = await readMultipart(ctx, LIMITS.lineSheetFileBytes);
    file = multipart.files.find((entry) => entry.fieldName === 'file');
  } catch (error) {
    if (error instanceof PartTooLarge) throw tooLarge(STATUS_COPY.importTooLarge);
    if (error instanceof ApiError && error.status === 415) {
      throw unsupportedMediaType(STATUS_COPY.importWrongType);
    }
    throw error;
  }
  if (file === undefined) throw unsupportedMediaType(STATUS_COPY.importWrongType);

  const parsed = parseLegacyLineSheet(file.bytes);
  if (!parsed.headerOk) throw unsupportedMediaType(STATUS_COPY.importWrongType);

  const styleByKey = new Map(drop.styles.map((style) => [matchKey(style.styleNumber), style]));
  const lastByKey = new Map<string, (typeof parsed.rows)[number]>();
  const linesByKey = new Map<string, number[]>();
  const orphans: { line: number; styleNumber: string }[] = [];
  const invalid: { line: number; field: string; message: string }[] = [];

  for (const row of parsed.rows) {
    if (row.invalidField !== null) {
      invalid.push({ line: row.line, field: row.invalidField, message: FIELD_COPY.range(0, 100_000) });
      continue;
    }
    const key = matchKey(row.styleNumber);
    if (!styleByKey.has(key)) {
      orphans.push({ line: row.line, styleNumber: row.styleNumber });
      continue;
    }
    lastByKey.set(key, row);
    linesByKey.set(key, [...(linesByKey.get(key) ?? []), row.line]);
  }

  let updated = 0;
  let unchanged = 0;
  const merged: MergeReport[] = [];
  const report: { line: number; styleNumber: string; outcome: string }[] = [];

  await transact(async (tx) => {
    for (const [key, row] of lastByKey) {
      const style = styleByKey.get(key);
      if (style === undefined) continue;
      const lines = linesByKey.get(key) ?? [];
      if (lines.length > 1) merged.push({ styleNumber: style.styleNumber, lines });
      const changes =
        style.name !== row.name ||
        style.colour !== row.colour ||
        style.wholesaleEdition !== row.wholesaleEdition ||
        style.rrpDkkMinor !== row.rrpDkkMinor;
      if (changes) {
        updated += 1;
        await tx.query(
          `update drop_styles set name = $3, colour = $4, wholesale_edition = $5, rrp_dkk_minor = $6
            where drop_id = $1 and style_number = $2`,
          [drop.id, style.styleNumber, row.name, row.colour, row.wholesaleEdition, row.rrpDkkMinor],
        );
      } else {
        unchanged += 1;
      }
      report.push({
        line: lines[lines.length - 1] as number,
        styleNumber: style.styleNumber,
        outcome: lines.length > 1 ? 'Merged' : changes ? 'Updated' : 'Unchanged',
      });
    }
  });

  sendJson(ctx.response, 200, {
    rows: parsed.rows.length,
    matched: lastByKey.size,
    updated,
    unchanged,
    merged,
    orphans,
    invalid,
    report: [
      ...report,
      ...orphans.map((entry) => ({ ...entry, outcome: 'Orphan' })),
      ...invalid.map((entry) => ({ line: entry.line, styleNumber: '', outcome: 'Invalid' })),
    ].sort((a, b) => a.line - b.line),
  });
}
