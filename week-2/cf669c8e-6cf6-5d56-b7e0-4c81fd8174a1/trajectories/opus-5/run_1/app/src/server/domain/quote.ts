/**
 * The quote: lines, place-of-supply VAT, notices and the payment schedule.
 *
 * This is the only place a kit or bike line list is built or a VAT rate is
 * chosen, so every surface shows the same figures.
 */

import {
  CONTROLLER,
  FIXED_LINES,
  INSPECTION_FEES,
  INSPECTION_FEE_NAME,
  ROAD_CLASS_NAMES,
  VAT_RATE_PCT,
  bikeById,
  hubById,
  packById,
} from '../../shared/seed.js';
import type {
  DeliveryCountry,
  FitResult,
  Fulfilment,
  Line,
  Quote,
  RegCountry,
  ResolvedDonor,
  RoadClass,
  Stage,
} from '../../shared/types.js';
import { buildScheduleAmounts, extractVat } from './money.js';
import { allocateStages, STAGE_ORDER } from './schedule.js';

export const INSURANCE_NOTICE =
  'Insurance: the scooter is uninsured on public roads once the work has begun, until it passes inspection.';
export const CLASS_MOVE_NOTICES = [
  'Plate: a new plate is needed for the new class.',
  'Helmet: a helmet is required in the 45 km/h class.',
  'Licence: check the licence your class requires before riding.',
];

/** Workshop fitting uses the NL rate whatever the delivery country. */
export function vatRateFor(fulfilment: Fulfilment, country: DeliveryCountry): number {
  return fulfilment === 'workshop' ? VAT_RATE_PCT.NL : VAT_RATE_PCT[country];
}

/** The inspection fee row in force on an Amsterdam date. */
export function inspectionFeeOn(country: RegCountry, amsterdamDate: string): { code: string; grossCents: number } {
  const rows = INSPECTION_FEES.filter((row) => row.country === country && row.from <= amsterdamDate);
  const row = rows[rows.length - 1];
  if (!row) throw new Error(`no inspection fee for ${country} on ${amsterdamDate}`);
  return { code: row.code, grossCents: row.grossCents };
}

export function isClassMove(donorClass: RoadClass, targetClass: RoadClass): boolean {
  return donorClass === 25 && targetClass === 45;
}

export interface DraftLine {
  code: string;
  name: string;
  grossCents: number;
  vatRatePct: number;
}

/**
 * Kit lines in their published order: hub, pack, `CTRL`, `TANK-OUT`, then
 * `POST` or `FIT`, then any inspection fee.
 */
export function kitLines(
  packId: string,
  hubId: string,
  donorClass: RoadClass,
  targetClass: RoadClass,
  regCountry: RegCountry,
  fulfilment: Fulfilment,
  country: DeliveryCountry,
  amsterdamDate: string,
): DraftLine[] {
  const pack = packById(packId);
  const hub = hubById(hubId);
  if (!pack || !hub) throw new Error(`unknown pack ${packId} or hub ${hubId}`);
  const rate = vatRateFor(fulfilment, country);

  const lines: DraftLine[] = [
    { code: hub.id, name: `Hub motor ${hub.id}`, grossCents: hub.grossCents, vatRatePct: rate },
    { code: pack.id, name: `Traction pack ${pack.id}`, grossCents: pack.grossCents, vatRatePct: rate },
    { code: CONTROLLER.code, name: CONTROLLER.name, grossCents: CONTROLLER.grossCents, vatRatePct: rate },
    {
      code: 'TANK-OUT',
      name: FIXED_LINES['TANK-OUT'].name,
      grossCents: FIXED_LINES['TANK-OUT'].grossCents,
      vatRatePct: rate,
    },
    fulfilment === 'workshop'
      ? { code: 'FIT', name: FIXED_LINES.FIT.name, grossCents: FIXED_LINES.FIT.grossCents, vatRatePct: rate }
      : { code: 'POST', name: FIXED_LINES.POST.name, grossCents: FIXED_LINES.POST.grossCents, vatRatePct: rate },
  ];

  if (isClassMove(donorClass, targetClass)) {
    const fee = inspectionFeeOn(regCountry, amsterdamDate);
    lines.push({ code: fee.code, name: INSPECTION_FEE_NAME, grossCents: fee.grossCents, vatRatePct: 0 });
  }

  return lines;
}

/** A built bike is a workshop handover at the NL rate. */
export function bikeLines(bikeId: string): DraftLine[] {
  const bike = bikeById(bikeId);
  if (!bike) throw new Error(`unknown bike ${bikeId}`);
  const rate = VAT_RATE_PCT.NL;
  return [
    { code: bike.id, name: bike.name, grossCents: bike.grossCents, vatRatePct: rate },
    {
      code: 'HANDOVER',
      name: FIXED_LINES.HANDOVER.name,
      grossCents: FIXED_LINES.HANDOVER.grossCents,
      vatRatePct: rate,
    },
  ];
}

export function kitNotices(donorClass: RoadClass, targetClass: RoadClass): string[] {
  return isClassMove(donorClass, targetClass)
    ? [INSURANCE_NOTICE, ...CLASS_MOVE_NOTICES]
    : [INSURANCE_NOTICE];
}

/** Turn draft lines into quote lines, extracting VAT per line in integer cents. */
export function toLines(drafts: readonly DraftLine[], idFor: (draft: DraftLine, index: number) => string): Line[] {
  return drafts.map((draft, index) => {
    const vatCents = extractVat(draft.grossCents, draft.vatRatePct);
    return {
      id: idFor(draft, index),
      code: draft.code,
      name: draft.name,
      grossCents: draft.grossCents,
      vatRatePct: draft.vatRatePct,
      vatCents,
      netCents: draft.grossCents - vatCents,
      collectedCents: 0,
      refundedCents: 0,
    };
  });
}

/** The schedule a fresh quote shows: four scheduled stages with allocations. */
export function freshSchedule(lines: readonly Line[]): Stage[] {
  const totalCents = lines.reduce((sum, line) => sum + line.grossCents, 0);
  const amounts = buildScheduleAmounts(totalCents);
  return allocateStages(
    lines.map((line) => ({
      id: line.id,
      grossCents: line.grossCents,
      vatCents: line.vatCents,
      ratePct: line.vatRatePct,
    })),
    STAGE_ORDER.map((stage) => ({
      stage,
      amountCents: amounts[stage],
      status: 'scheduled' as const,
      dueDate: null,
      attempts: 0,
      confirmedAt: null,
      vatCorrectedCents: 0,
      locked: null,
      returnedByLine: new Map(),
    })),
  );
}

export interface KitQuoteInput {
  donor: ResolvedDonor;
  packId: string;
  hubId: string;
  roadClass: RoadClass;
  fulfilment: Fulfilment;
  country: DeliveryCountry;
  amsterdamDate: string;
  fit: FitResult;
}

export function buildKitQuote(input: KitQuoteInput): Quote {
  const drafts = kitLines(
    input.packId,
    input.hubId,
    input.donor.roadClass,
    input.roadClass,
    input.donor.country,
    input.fulfilment,
    input.country,
    input.amsterdamDate,
  );
  const lines = toLines(drafts, (draft) => draft.code);
  return {
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.grossCents, 0),
    vatCents: lines.reduce((sum, line) => sum + line.vatCents, 0),
    vatRatePct: vatRateFor(input.fulfilment, input.country),
    schedule: freshSchedule(lines),
    notices: kitNotices(input.donor.roadClass, input.roadClass),
    fit: input.fit,
  };
}

export function buildBikeQuote(bikeId: string): Quote {
  const lines = toLines(bikeLines(bikeId), (draft) => draft.code);
  return {
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.grossCents, 0),
    vatCents: lines.reduce((sum, line) => sum + line.vatCents, 0),
    vatRatePct: VAT_RATE_PCT.NL,
    schedule: freshSchedule(lines),
    notices: [],
    fit: null,
  };
}

export function classNameFor(country: RegCountry, roadClass: RoadClass): string {
  return ROAD_CLASS_NAMES[country][roadClass];
}
