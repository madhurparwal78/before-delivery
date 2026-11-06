import { isDanishVat, type Currency, type Market } from './markets.ts';
import { danishVat } from './money.ts';

export interface PriceListRow {
  listId: string;
  effectiveDate: string;
  createdAtMs: number;
  styleNumber: string;
  currency: Currency;
  unitPriceMinor: number;
}

export interface PricedLine {
  styleNumber: string;
  styleName: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  unitPriceMinor: number | null;
  netMinor: number | null;
  vatMinor: number | null;
  lineTotalMinor: number | null;
}

/**
 * The price in force for a style and currency on a Copenhagen date: the latest-effective list
 * dated on or before that date that prices that style in that currency, with equal dates going
 * to the later-created list.
 */
export function priceInForce(
  rows: readonly PriceListRow[],
  styleNumber: string,
  currency: Currency,
  onDate: string,
): PriceListRow | null {
  const candidates = rows.filter(
    (row) =>
      row.styleNumber.trim().toUpperCase() === styleNumber.trim().toUpperCase() &&
      row.currency === currency &&
      row.effectiveDate <= onDate,
  );
  let best: PriceListRow | null = null;
  for (const row of candidates) {
    if (
      best === null ||
      row.effectiveDate > best.effectiveDate ||
      (row.effectiveDate === best.effectiveDate && row.createdAtMs > best.createdAtMs)
    ) {
      best = row;
    }
  }
  return best;
}

export interface LineToPrice {
  styleNumber: string;
  styleName: string;
  requestedQuantity: number;
  allocatedQuantity: number;
}

export interface PricingResult {
  lines: PricedLine[];
  totalMinor: number;
  /** The effective date of the newest list that priced any line, or null when nothing was priced. */
  priceListEffectiveDate: string | null;
  /** Style numbers with a quantity above 0 and no price in force. */
  missing: string[];
}

/** Prices every line with a quantity above 0; lines of 0 are kept but not priced. */
export function priceAllocation(
  lines: readonly LineToPrice[],
  market: Market,
  currency: Currency,
  onDate: string,
  rows: readonly PriceListRow[],
): PricingResult {
  const missing: string[] = [];
  let totalMinor = 0;
  let effectiveDate: string | null = null;

  const priced = lines.map((line): PricedLine => {
    if (line.allocatedQuantity <= 0) {
      return {
        styleNumber: line.styleNumber,
        styleName: line.styleName,
        requestedQuantity: line.requestedQuantity,
        allocatedQuantity: line.allocatedQuantity,
        unitPriceMinor: null,
        netMinor: null,
        vatMinor: null,
        lineTotalMinor: null,
      };
    }
    const row = priceInForce(rows, line.styleNumber, currency, onDate);
    if (row === null) {
      missing.push(line.styleNumber);
      return {
        styleNumber: line.styleNumber,
        styleName: line.styleName,
        requestedQuantity: line.requestedQuantity,
        allocatedQuantity: line.allocatedQuantity,
        unitPriceMinor: null,
        netMinor: null,
        vatMinor: null,
        lineTotalMinor: null,
      };
    }
    const netMinor = row.unitPriceMinor * line.allocatedQuantity;
    const vatMinor = isDanishVat(market) ? danishVat(netMinor) : 0;
    const lineTotalMinor = netMinor + vatMinor;
    totalMinor += lineTotalMinor;
    if (effectiveDate === null || row.effectiveDate > effectiveDate) effectiveDate = row.effectiveDate;
    return {
      styleNumber: line.styleNumber,
      styleName: line.styleName,
      requestedQuantity: line.requestedQuantity,
      allocatedQuantity: line.allocatedQuantity,
      unitPriceMinor: row.unitPriceMinor,
      netMinor,
      vatMinor,
      lineTotalMinor,
    };
  });

  return { lines: priced, totalMinor, priceListEffectiveDate: effectiveDate, missing };
}
