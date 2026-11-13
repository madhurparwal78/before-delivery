// Written amounts shared by on-screen copy and emails.

/** "3 h" for whole hours, "2 h 30" when there are minutes, "30 min" under an hour. */
export function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0 && rest === 0) return "0 min";
  if (rest === 0) return `${hours} h`;
  return hours > 0 ? `${hours} h ${rest}` : `${rest} min`;
}

/** Booking minutes: the span's minutes times the number of stations the booking occupies. */
export function bookingMinutes(spanMinutes: number, stationCount: number): number {
  return spanMinutes * stationCount;
}

/** Whole cents written as dollars with two decimals, without a float in between. */
export function dollars(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export const LAPSE_TEXT = {
  not_approved: "not approved yet",
  insurance_lapsed: "certificate of insurance lapsed",
  food_handler_lapsed: "food-handler card lapsed",
} as const;

/** The span hints: shown beside the slab and the claim button, and the sentences of booking-shape rules 7 and 8. */
export const SPAN_HINT_TEXT = {
  length: "Pick a span of at least 2 h",
  started: "That span has already started. Pick a later span.",
  beyond_horizon: "Bookings open up to 60 days ahead. Pick an earlier date.",
} as const;
