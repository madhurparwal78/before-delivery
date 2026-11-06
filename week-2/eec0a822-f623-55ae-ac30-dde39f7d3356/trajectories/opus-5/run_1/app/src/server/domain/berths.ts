import { roundHalfUp } from './money.js';
import { addDays } from '../../shared/zone.js';

export const DRAFT_CLEARANCE_CM = 30;
export const MAX_NIGHTS = 14;
export const SHORE_POWER_SLOT_KW_FLOOR = 22;

export interface BerthSize {
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly depthCm: number;
}

export interface YachtSize {
  readonly lengthCm: number;
  readonly beamCm: number;
  readonly draftCm: number;
}

/** The one berth fit rule, compared in whole centimetres. */
export function berthFits(yacht: YachtSize, berth: BerthSize): boolean {
  return (
    yacht.lengthCm <= berth.lengthCm &&
    yacht.beamCm <= berth.widthCm &&
    yacht.draftCm + DRAFT_CLEARANCE_CM <= berth.depthCm
  );
}

export function nightDates(arrivalDate: string, nights: number): string[] {
  return Array.from({ length: nights }, (_, index) => addDays(arrivalDate, index));
}

/** A night's fee: the tariff in force that night times the yacht's length in metres. */
export function nightFeeMinor(ratePerMetreMinor: number, yachtLengthCm: number): bigint {
  return roundHalfUp(BigInt(ratePerMetreMinor) * BigInt(yachtLengthCm), 100n);
}

export interface TariffRow {
  readonly id: string;
  readonly effective_date: string;
  readonly rate_per_metre_minor: number;
}

export function tariffInForce(
  tariffs: readonly TariffRow[],
  date: string,
): TariffRow {
  let chosen: TariffRow | null = null;
  for (const tariff of tariffs) {
    if (tariff.effective_date <= date && (chosen === null || tariff.effective_date > chosen.effective_date)) {
      chosen = tariff;
    }
  }
  if (chosen === null) throw new Error(`No tariff in force on ${date}`);
  return chosen;
}
