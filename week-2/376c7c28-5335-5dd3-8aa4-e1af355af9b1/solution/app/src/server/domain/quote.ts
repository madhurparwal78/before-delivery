/**
 * The published fee quote rule, decided only here.
 *
 * Dimensions are held as integer hundredths of an inch. Rounded dimensions are held as
 * integer halves of an inch, so cubic volume is an exact integer count of eighths of a
 * cubic inch and the fee never touches floating point.
 */

export type Membership = 'member' | 'drop_off';
type Firing = 'bisque' | 'glaze';

export interface RateSchedule {
  readonly id: string;
  readonly effective_from: string;
  readonly member_bisque_cents: number;
  readonly member_glaze_cents: number;
  readonly dropoff_bisque_cents: number;
  readonly dropoff_glaze_cents: number;
}

/** Step 1: round up to the next multiple of 0.5 in, as a count of half inches. */
export function roundUpToHalves(hundredths: number): number {
  return Math.ceil(hundredths / 50);
}

/** Step 2: exact volume as a count of eighths of a cubic inch. */
function cubicEighths(lengthHalves: number, widthHalves: number, heightHalves: number): number {
  return lengthHalves * widthHalves * heightHalves;
}

/** Step 3: cents = cubic inches x whole-cent rate, rounded once per piece, halves up. */
export function feeCents(volumeEighths: number, rateCents: number): number {
  return Math.floor((volumeEighths * rateCents + 4) / 8);
}

/** Step 4: the rate for a firing and a membership. */
function rateFor(schedule: RateSchedule, membership: Membership, firing: Firing): number {
  if (membership === 'member') {
    return firing === 'bisque' ? schedule.member_bisque_cents : schedule.member_glaze_cents;
  }
  return firing === 'bisque' ? schedule.dropoff_bisque_cents : schedule.dropoff_glaze_cents;
}

export function inchesFromHalves(halves: number): number {
  return halves / 2;
}

export function inchesFromHundredths(hundredths: number): number {
  return hundredths / 100;
}

export function cubicInches(volumeEighths: number): number {
  return volumeEighths / 8;
}

interface QuotedDimensions {
  readonly lengthHundredths: number;
  readonly widthHundredths: number;
  readonly heightHundredths: number;
}

interface QuoteResult {
  readonly roundedLengthHalves: number;
  readonly roundedWidthHalves: number;
  readonly roundedHeightHalves: number;
  readonly volumeEighths: number;
  readonly bisqueRateCents: number;
  readonly bisqueFeeCents: number;
  readonly glazeRateCents: number;
  readonly glazeFeeCents: number;
  readonly ratesEffectiveFrom: string;
}

export function quote(
  dims: QuotedDimensions,
  membership: Membership,
  schedule: RateSchedule,
): QuoteResult {
  const l = roundUpToHalves(dims.lengthHundredths);
  const w = roundUpToHalves(dims.widthHundredths);
  const h = roundUpToHalves(dims.heightHundredths);
  const volume = cubicEighths(l, w, h);
  const bisqueRate = rateFor(schedule, membership, 'bisque');
  const glazeRate = rateFor(schedule, membership, 'glaze');
  return {
    roundedLengthHalves: l,
    roundedWidthHalves: w,
    roundedHeightHalves: h,
    volumeEighths: volume,
    bisqueRateCents: bisqueRate,
    bisqueFeeCents: feeCents(volume, bisqueRate),
    glazeRateCents: glazeRate,
    glazeFeeCents: feeCents(volume, glazeRate),
    ratesEffectiveFrom: schedule.effective_from,
  };
}
