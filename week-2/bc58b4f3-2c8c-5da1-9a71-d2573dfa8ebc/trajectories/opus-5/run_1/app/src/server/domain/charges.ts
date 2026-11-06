import type { ChargeLine, ServiceLine } from '../../shared/contract.js';

export const MINIMUM_BILLABLE_MINUTES = 120;
export const BILLING_INCREMENT_MINUTES = 15;
/** The free radius is 20 miles, so the first 40 round-trip miles carry no mileage. */
export const FREE_ROUND_TRIP_MILES = 40;

export interface RateInForce {
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}

export interface SeatWork {
  seat: number;
  actual_minutes: number | null;
  round_trip_miles: number;
}

export function serviceLineFor(languageCode: string): ServiceLine {
  return languageCode === 'asl' ? 'asl' : 'spoken';
}

/** The greater of the two-hour minimum and the actual minutes rounded up to the quarter hour. */
export function billableMinutesFor(actualMinutes: number | null): number {
  if (actualMinutes === null) {
    return MINIMUM_BILLABLE_MINUTES;
  }
  const rounded = Math.ceil(actualMinutes / BILLING_INCREMENT_MINUTES) * BILLING_INCREMENT_MINUTES;
  return Math.max(MINIMUM_BILLABLE_MINUTES, rounded);
}

/** hourly rate × minutes ÷ 60, rounded half-up to the whole cent, in integer arithmetic. */
export function seatAmountCents(hourlyRateCents: number, billableMinutes: number): number {
  const numerator = hourlyRateCents * billableMinutes;
  const whole = Math.floor(numerator / 60);
  const remainder = numerator - whole * 60;
  return remainder * 2 >= 60 ? whole + 1 : whole;
}

export function billableMilesFor(roundTripMiles: number): number {
  return Math.max(0, roundTripMiles - FREE_ROUND_TRIP_MILES);
}

export function chargeLinesFor(seats: SeatWork[], rate: RateInForce): ChargeLine[] {
  return seats.map((seat) => {
    const billableMinutes = billableMinutesFor(seat.actual_minutes);
    const billableMiles = billableMilesFor(seat.round_trip_miles);
    return {
      seat: seat.seat,
      actual_minutes: seat.actual_minutes,
      billable_minutes: billableMinutes,
      amount_cents: seatAmountCents(rate.hourly_rate_cents, billableMinutes),
      round_trip_miles: seat.round_trip_miles,
      billable_miles: billableMiles,
      mileage_cents: billableMiles * rate.mileage_cents_per_mile,
    };
  });
}

export function totalCentsOf(lines: ChargeLine[]): number {
  return lines.reduce((sum, line) => sum + line.amount_cents + line.mileage_cents, 0);
}
