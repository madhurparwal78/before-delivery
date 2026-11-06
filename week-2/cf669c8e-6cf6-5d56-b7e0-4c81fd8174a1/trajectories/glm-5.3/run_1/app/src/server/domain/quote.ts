import { PACKS, HUBS, FIXED_LINES, VAT_RATES, inspectionFeeCents, BIKES } from './seed.js';
import { lineVatCents, scheduleAmounts } from './money.js';
import type { FitResult } from './fit.js';

// Quote decisions: lines, VAT, schedule. One place decides a quote.

export type Fulfilment = 'posted' | 'workshop';
export type RoadClass = 25 | 45;

export interface QuoteLine {
  id: string;
  code: string;
  name: string;
  grossCents: number;
  vatRatePct: number;
  vatCents: number;
  netCents: number;
}

export interface QuoteStage {
  stage: string;
  label: string;
  amountCents: number;
}

export interface KitConfig {
  kind: 'kit';
  donorModel: string;
  donorCountry: string;
  donorClass: RoadClass;
  packId: string;
  hubId: string;
  roadClass: RoadClass;
  fulfilment: Fulfilment;
  country: string;
}

export function kitQuoteLines(config: KitConfig, amsterdamDate: string): QuoteLine[] {
  const pack = PACKS.find((p) => p.id === config.packId)!;
  const hub = HUBS.find((h) => h.id === config.hubId)!;
  const rate = config.fulfilment === 'posted' ? VAT_RATES[config.country]! : VAT_RATES['NL']!;
  const lines: QuoteLine[] = [];
  const push = (id: string, code: string, name: string, grossCents: number, vatRatePct: number) => {
    const vat = lineVatCents(grossCents, vatRatePct);
    lines.push({ id, code, name, grossCents, vatRatePct, vatCents: vat, netCents: grossCents - vat });
  };
  push(`hub-${hub.id}`, hub.id, `Hub motor ${hub.id}`, hub.grossCents, rate);
  push(`pack-${pack.id}`, pack.id, `Traction pack ${pack.id}`, pack.grossCents, rate);
  const ctrl = FIXED_LINES['CTRL']!;
  push('line-CTRL', 'CTRL', ctrl.name, ctrl.grossCents, rate);
  const tank = FIXED_LINES['TANK-OUT']!;
  push('line-TANK-OUT', 'TANK-OUT', tank.name, tank.grossCents, rate);
  if (config.fulfilment === 'posted') {
    const post = FIXED_LINES['POST']!;
    push('line-POST', 'POST', post.name, post.grossCents, rate);
  } else {
    const fit = FIXED_LINES['FIT']!;
    push('line-FIT', 'FIT', fit.name, fit.grossCents, rate);
  }
  if (config.donorClass !== config.roadClass) {
    const fee = inspectionFeeCents(config.donorCountry, amsterdamDate);
    push(`line-${fee.code}`, fee.code, 'Inspection fee', fee.cents, 0);
  }
  return lines;
}

export function bikeQuoteLines(bikeId: string): QuoteLine[] {
  const bike = BIKES.find((b) => b.id === bikeId)!;
  const rate = VAT_RATES['NL']!;
  const lines: QuoteLine[] = [];
  const push = (id: string, code: string, name: string, grossCents: number) => {
    const vat = lineVatCents(grossCents, rate);
    lines.push({ id, code, name, grossCents, vatRatePct: rate, vatCents: vat, netCents: grossCents - vat });
  };
  push(`bike-${bike.id}`, bike.id, bike.name, bike.grossCents);
  const handover = FIXED_LINES['HANDOVER']!;
  push('line-HANDOVER', 'HANDOVER', handover.name, handover.grossCents);
  return lines;
}

export function quoteOf(lines: QuoteLine[], fit: FitResult | null): {
  lines: QuoteLine[];
  totalCents: number;
  vatCents: number;
  vatRatePct: number;
  schedule: QuoteStage[];
  notices: string[];
} {
  const totalCents = lines.reduce((s, l) => s + l.grossCents, 0);
  const vatCents = lines.reduce((s, l) => s + l.vatCents, 0);
  const amounts = scheduleAmounts(totalCents);
  const schedule: QuoteStage[] = amounts.map((amount, i) => ({
    stage: i === 0 ? 'deposit' : `instalment-${i}`,
    label: i === 0 ? 'Deposit' : `Instalment ${i}`,
    amountCents: amount,
  }));
  const notices: string[] = [
    'Insurance: the scooter is uninsured on public roads once the work has begun, until it passes inspection.',
  ];
  void fit;
  return { lines, totalCents, vatCents, vatRatePct: lines[0]?.vatRatePct ?? 21, schedule, notices };
}

export function classMoveNotices(): string[] {
  return [
    'Plate: a new plate is needed for the new class.',
    'Helmet: a helmet is required in the 45 km/h class.',
    'Licence: check the licence your class requires before riding.',
  ];
}
