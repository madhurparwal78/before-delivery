import { ClassCode, PassengerState, QuotaCode, BandCode } from '../types.js';
import { gstOnChargePaise, CLASS_RATES } from '../fare.js';
import { roundHalfUp } from '../money.js';
import { paiseToRupees } from '../money.js';

// The deduction band and its edges, decided in exactly one place. The band is
// decided per passenger on the business clock at the instant the request
// arrives; a cancellation never reuses a quote.

export interface BandInput {
  state: PassengerState;
  age: number;
  cls: ClassCode;
  quota: QuotaCode;
  farePaise: number;
  chartPrepared: boolean;
  /** minutes from the scheduled departure from the PNR's From stop */
  minutesToDeparture: number;
}

export interface BandOutput {
  band: BandCode;
  chargePaise: number;
  gstPaise: number;
  deductionPaise: number;
  refundPaise: number;
}

/** GST carries on 3A for these bands only; every other band and every SL charge has GST 0. */
const GST_BANDS = new Set<BandCode>(['flat', 'quarter', 'half', 'clerkage', 'party_clerkage', 'rac_after_chart']);

export function applyBand(input: BandInput): BandOutput {
  const { state, age, cls, quota, farePaise, chartPrepared, minutesToDeparture } = input;
  let band: BandCode;
  let charge: number;

  const flatCharge = cls === 'SL' ? 12000 : 18000;

  if (age < 5) {
    band = 'no_fare'; charge = 0;
  } else if (state === 'RAC' && chartPrepared && minutesToDeparture >= 30) {
    band = 'rac_after_chart'; charge = 6000;
  } else if (state === 'CNF' && chartPrepared) {
    band = 'after_chart'; charge = farePaise;
  } else if (state === 'RAC' && chartPrepared) {
    band = 'after_chart'; charge = farePaise;
  } else if (quota === 'TQ' && state === 'CNF') {
    band = 'tatkal_confirmed'; charge = farePaise;
  } else if (state === 'RAC' || state === 'GNWL' || state === 'RLWL' || state === 'PQWL' || state === 'TQWL') {
    band = 'clerkage'; charge = 6000;
  } else if (state === 'CNF' && minutesToDeparture > 48 * 60) {
    band = 'flat'; charge = flatCharge;
  } else if (state === 'CNF' && minutesToDeparture >= 12 * 60) {
    band = 'quarter'; charge = Math.max(roundHalfUp(farePaise * 0.25), flatCharge);
  } else if (state === 'CNF') {
    band = 'half'; charge = Math.max(roundHalfUp(farePaise * 0.5), flatCharge);
  } else if (state === 'NOSB') {
    band = 'no_fare'; charge = 0;
  } else {
    // CAN and CHART_NOT_CONFIRMED are cancelled already; the caller refuses them.
    band = 'after_chart'; charge = farePaise;
  }

  let gst = GST_BANDS.has(band) ? gstOnChargePaise(charge, cls) : 0;
  let deduction = charge + gst;
  if (deduction > farePaise) {
    // the GST stays as computed; the charge is lowered to the fare minus the GST
    charge = Math.max(0, farePaise - gst);
    deduction = Math.min(farePaise, charge + gst);
    if (charge + gst < farePaise) deduction = farePaise;
    if (gst > farePaise) { gst = farePaise; charge = 0; deduction = farePaise; }
  }
  return {
    band,
    chargePaise: charge,
    gstPaise: gst,
    deductionPaise: deduction,
    refundPaise: farePaise - deduction,
  };
}

/** Part-confirmed party: a General cancellation before the chart selecting every
 * uncancelled passenger aged 5 or over, with at least one CNF and one RAC or WL. */
export function isPartConfirmedParty(
  quota: QuotaCode,
  chartPrepared: boolean,
  selectedStates: PassengerState[],
  unselectedAdults: number,
): boolean {
  if (quota !== 'GN' || chartPrepared) return false;
  if (unselectedAdults > 0) return false;
  const hasCnf = selectedStates.some((s) => s === 'CNF');
  const hasQueue = selectedStates.some((s) => s === 'RAC' || s === 'GNWL' || s === 'RLWL' || s === 'PQWL' || s === 'TQWL');
  return hasCnf && hasQueue;
}

/** Clerkage band used for the whole remaining party of a part-confirmed cancellation. */
export function partyClerkage(farePaise: number, cls: ClassCode): BandOutput {
  const charge = 6000;
  const gst = gstOnChargePaise(charge, cls);
  const deduction = Math.min(charge + gst, farePaise);
  const realCharge = Math.max(0, deduction - gst);
  return {
    band: 'party_clerkage',
    chargePaise: realCharge,
    gstPaise: gst,
    deductionPaise: deduction,
    refundPaise: farePaise - deduction,
  };
}

export { paiseToRupees };
