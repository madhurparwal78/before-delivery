import type { Quota, TravelClass } from './berths';
import { GST_DENOMINATOR, GST_NUMERATOR, chargesGst, isChild } from './fare';
import type { Paise } from './money';
import { RUPEE, roundHalfUp } from './money';
import type { PassengerStatusKind } from './status';
import { isWaitingList } from './status';

export type DeductionBand =
  | 'flat'
  | 'quarter'
  | 'half'
  | 'tatkal_confirmed'
  | 'clerkage'
  | 'party_clerkage'
  | 'rac_after_chart'
  | 'after_chart'
  | 'chart_full'
  | 'no_fare';

const CLERKAGE: Paise = 60 * RUPEE;
const FLAT_CHARGE: Readonly<Record<TravelClass, Paise>> = { SL: 120 * RUPEE, '3A': 180 * RUPEE };
const HOUR = 3_600_000;
const RAC_AFTER_CHART_CUTOFF = 30 * 60_000;

const GST_BANDS: readonly DeductionBand[] = [
  'flat',
  'quarter',
  'half',
  'clerkage',
  'party_clerkage',
  'rac_after_chart',
];

export interface BandInput {
  readonly status: PassengerStatusKind;
  readonly age: number;
  readonly quota: Quota;
  readonly travelClass: TravelClass;
  readonly farePaise: Paise;
  readonly now: number;
  readonly chartInstant: number;
  readonly departureAt: number;
  readonly partConfirmedParty: boolean;
}

export interface Deduction {
  readonly band: DeductionBand;
  readonly charge_paise: Paise;
  readonly gst_paise: Paise;
  readonly deduction_paise: Paise;
  readonly refund_paise: Paise;
}

/** The deduction band, decided on the business clock at the instant the request arrives. */
export function deductionBand(input: BandInput): DeductionBand {
  const { status, age, quota, now, chartInstant, departureAt } = input;
  if (isChild(age)) return 'no_fare';
  const afterChart = now >= chartInstant;
  if (afterChart && status === 'RAC' && now <= departureAt - RAC_AFTER_CHART_CUTOFF) {
    return 'rac_after_chart';
  }
  if (afterChart && (status === 'CNF' || status === 'RAC')) return 'after_chart';
  if (input.partConfirmedParty) return 'party_clerkage';
  if (status === 'CNF' && quota === 'TQ') return 'tatkal_confirmed';
  if (status === 'RAC' || isWaitingList(status)) return 'clerkage';
  const untilDeparture = departureAt - now;
  if (untilDeparture > 48 * HOUR) return 'flat';
  if (untilDeparture >= 12 * HOUR) return 'quarter';
  return 'half';
}

function bandCharge(band: DeductionBand, input: BandInput): Paise {
  const flat = FLAT_CHARGE[input.travelClass];
  switch (band) {
    case 'no_fare':
      return 0;
    case 'rac_after_chart':
    case 'clerkage':
    case 'party_clerkage':
      return CLERKAGE;
    case 'after_chart':
    case 'tatkal_confirmed':
      return input.farePaise;
    case 'chart_full':
      return 0;
    case 'flat':
      return flat;
    case 'quarter':
      return Math.max(flat, roundHalfUp(input.farePaise * 0.25));
    case 'half':
      return Math.max(flat, roundHalfUp(input.farePaise * 0.5));
  }
}

/** On 3A, 5% GST on the charge, rounded half up once per passenger. */
function chargeGst(band: DeductionBand, travelClass: TravelClass, charge: Paise): Paise {
  if (!chargesGst(travelClass) || !GST_BANDS.includes(band)) return 0;
  return roundHalfUp((charge * GST_NUMERATOR) / GST_DENOMINATOR);
}

export function computeDeduction(input: BandInput): Deduction {
  const band = deductionBand(input);
  const rawCharge = bandCharge(band, input);
  const gst = chargeGst(band, input.travelClass, rawCharge);
  let charge = rawCharge;
  let deduction = charge + gst;
  if (deduction > input.farePaise) {
    charge = input.farePaise - gst;
    deduction = input.farePaise;
  }
  return {
    band,
    charge_paise: charge,
    gst_paise: gst,
    deduction_paise: deduction,
    refund_paise: input.farePaise - deduction,
  };
}

/** The chart's own band: the whole fare comes back, with no charge. */
export function chartFullDeduction(farePaise: Paise): Deduction {
  return {
    band: 'chart_full',
    charge_paise: 0,
    gst_paise: 0,
    deduction_paise: 0,
    refund_paise: farePaise,
  };
}
