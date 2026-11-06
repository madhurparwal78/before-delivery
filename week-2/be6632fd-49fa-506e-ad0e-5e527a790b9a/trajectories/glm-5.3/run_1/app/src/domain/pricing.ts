// Line pricing and VAT — decided here alone. Copenhagen-market stockists get 25%
// VAT on each line, rounded half up on that line alone; yen has no minor unit.
export interface PricedLine {
  styleNumber: string;
  styleName: string;
  quantity: number;
  unitPriceMinor: number;
  netMinor: number;
  vatMinor: number;
  lineTotalMinor: number;
}

export function priceLine(unitPriceMinor: number, quantity: number, danishVat: boolean, currency: string): { netMinor: number; vatMinor: number; lineTotalMinor: number } {
  const netMinor = currency === 'JPY' ? unitPriceMinor * quantity : unitPriceMinor * quantity;
  const vatMinor = danishVat ? roundHalfUp(netMinor * 25, 100) : 0;
  return { netMinor, vatMinor, lineTotalMinor: netMinor + vatMinor };
}

export function roundHalfUp(value: number, denominator: number): number {
  const n = value / denominator;
  return Math.floor(n + 0.5);
}

export function vatOf(netMinor: number, danishVat: boolean): number {
  return danishVat ? roundHalfUp(netMinor * 25, 100) : 0;
}

export function priceLines(lines: { styleNumber: string; styleName: string; quantity: number }[], unitPrice: (styleNumber: string) => number | null, danishVat: boolean, currency: string): { lines: PricedLine[]; missing: string[] } {
  const out: PricedLine[] = [];
  const missing: string[] = [];
  for (const l of lines) {
    if (l.quantity <= 0) continue;
    const unit = unitPrice(l.styleNumber);
    if (unit == null) { missing.push(l.styleNumber); continue; }
    const netMinor = unit * l.quantity;
    const vatMinor = vatOf(netMinor, danishVat);
    out.push({ styleNumber: l.styleNumber, styleName: l.styleName, quantity: l.quantity, unitPriceMinor: unit, netMinor, vatMinor, lineTotalMinor: netMinor + vatMinor });
  }
  return { lines: out, missing };
}

// Price-list selection: the latest-effective list dated on or before the date that
// prices that style in that currency; equal dates go to the later-created list.
export interface PriceListEntry { effectiveDate: string; createdAt: number | string; prices: Map<string, number>; }

export function priceInForce(lists: PriceListEntry[], effectiveDate: string, styleNumber: string, currency: string): number | null {
  let best: PriceListEntry | null = null;
  for (const list of lists) {
    if (list.effectiveDate > effectiveDate) continue;
    if (!list.prices.has(`${styleNumber}|${currency}`)) continue;
    if (!best) { best = list; continue; }
    if (list.effectiveDate > best.effectiveDate) best = list;
    else if (list.effectiveDate === best.effectiveDate && String(list.createdAt) > String(best.createdAt)) best = list;
  }
  return best ? best.prices.get(`${styleNumber}|${currency}`) ?? null : null;
}
