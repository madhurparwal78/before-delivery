import { off, roundMul } from "./money.js";
import { daysBetween } from "./dates.js";

export type Plan = "refundable" | "nonrefundable";

export type PriceStepKey =
  | "plan_rate" | "occupancy" | "children" | "length_of_stay" | "early_booking"
  | "last_minute" | "loyalty" | "breakfast" | "vat" | "city_tax" | "tourism_levy" | "night_total";

export const PRICE_LINE_ORDER: PriceStepKey[] = [
  "plan_rate", "occupancy", "children", "length_of_stay", "early_booking", "last_minute",
  "loyalty", "breakfast", "vat", "city_tax", "tourism_levy", "night_total"
];

export const LINE_LABEL_KEYS: Record<PriceStepKey, string> = {
  plan_rate: "Plan rate", occupancy: "Occupancy", children: "Children",
  length_of_stay: "Length of stay", early_booking: "Early booking", last_minute: "Last minute",
  loyalty: "Loyalty", breakfast: "Breakfast", vat: "VAT", city_tax: "City tax",
  tourism_levy: "Tourism levy", night_total: "Night total"
};

export type TaxConfig = {
  vat_pct: number;
  city_minor: number;
  levy_pct: number;
  breakfast_minor: number;
  single_pct: number;
};

export type RoomTypePricing = {
  included_adults: number;
  max_adults: number;
  max_guests: number;
  extra_adult_minor: number;
  child_minor: number;
};

export type PriceRoomInput = {
  room_type: string;
  base_rate_minor: number;
  plan: Plan;
  breakfast: boolean;
  adults: number;
  ages: number[];
  tax: TaxConfig;
  roomType: RoomTypePricing;
  nights: number;
  /** whole calendar days from property-local today to arrival */
  days_ahead: number;
  /** loyalty tier percent */
  tier_pct: number;
};

export type PriceLine = { key: PriceStepKey; minor: number };

export type PricedNight = {
  date: string;
  lines: PriceLine[];
  total_minor: number;
  taxable_minor: number;
};

/**
 * The published nightly price build. Each step rounds once, per night and per room.
 * Price lines carry each step's change, so the lines add up to the night total.
 */
export function priceNight(input: PriceRoomInput): { room_amount_minor: number; lines: PriceLine[]; total_minor: number; taxable_minor: number } {
  const { tax, roomType } = input;
  const lines: PriceLine[] = [];
  // 1. Plan rate.
  let x = input.base_rate_minor;
  if (input.plan === "nonrefundable") x = off(x, 10);
  lines.push({ key: "plan_rate", minor: x });
  const applyOff = (p: number, key: PriceStepKey) => {
    const before = x;
    x = off(x, p);
    const d = x - before;
    if (d !== 0) lines.push({ key, minor: d });
  };
  // 2. Occupancy.
  let occ = 0;
  if (input.adults > roomType.included_adults) {
    occ = roomType.extra_adult_minor * (input.adults - roomType.included_adults);
  } else if (input.adults === 1 && roomType.included_adults >= 2) {
    occ = off(x, tax.single_pct) - x;
  }
  if (occ !== 0) { x += occ; lines.push({ key: "occupancy", minor: occ }); }
  // 3. Children by age.
  let kids = 0;
  for (const age of input.ages) {
    if (age <= 2) kids += 0;
    else if (age <= 11) kids += roomType.child_minor;
    else kids += roomType.extra_adult_minor;
  }
  if (kids !== 0) { x += kids; lines.push({ key: "children", minor: kids }); }
  // 4. Length of stay.
  const losApplied = input.nights >= 7;
  if (input.nights >= 14) applyOff(12, "length_of_stay");
  else if (input.nights >= 7) applyOff(8, "length_of_stay");
  // 5. Early booking or last minute (skipped when step 4 applied; never for nonrefundable).
  if (input.plan !== "nonrefundable" && !losApplied) {
    if (input.days_ahead >= 60) applyOff(10, "early_booking");
    else if (input.days_ahead <= 3) applyOff(15, "last_minute");
  }
  // 6. Loyalty.
  if (input.tier_pct > 0) applyOff(input.tier_pct, "loyalty");
  const room_amount = x;
  // 7. Breakfast, no discount.
  let bf = 0;
  if (input.breakfast) {
    let persons = input.adults;
    for (const age of input.ages) if (age >= 3) persons++;
    bf = tax.breakfast_minor * persons;
  }
  if (bf !== 0) lines.push({ key: "breakfast", minor: bf });
  const t = x + bf;
  // 8. VAT.
  const vat = roundMul(t, tax.vat_pct, 100);
  if (vat !== 0) lines.push({ key: "vat", minor: vat });
  // 9. City tax per person aged 12 or more.
  let taxablePersons = input.adults;
  for (const age of input.ages) if (age >= 12) taxablePersons++;
  const city = tax.city_minor * taxablePersons;
  if (city !== 0) lines.push({ key: "city_tax", minor: city });
  // 10. Tourism levy (tax on tax).
  const levy = roundMul(city, tax.levy_pct, 100);
  if (levy !== 0) lines.push({ key: "tourism_levy", minor: levy });
  const total = t + vat + city + levy;
  lines.push({ key: "night_total", minor: total });
  return { room_amount_minor: room_amount, lines, total_minor: total, taxable_minor: t };
}

export function mergeLines(perRoom: PriceLine[][]): PriceLine[] {
  const out: PriceLine[] = [];
  for (const key of PRICE_LINE_ORDER) {
    let sum = 0;
    for (const lines of perRoom) {
      const l = lines.find((x) => x.key === key);
      if (l) sum += l.minor;
    }
    if (sum !== 0 || key === "night_total") out.push({ key, minor: sum });
  }
  return out;
}

export const TIER_NAMES = ["Wren", "Heron", "Kestrel"] as const;
export type TierName = (typeof TIER_NAMES)[number];

export const TIERS: { name: TierName; min_stays: number; pct: number; perks: ("perk.late" | "perk.drink")[] }[] = [
  { name: "Wren", min_stays: 0, pct: 0, perks: [] },
  { name: "Heron", min_stays: 2, pct: 5, perks: ["perk.late"] },
  { name: "Kestrel", min_stays: 5, pct: 10, perks: ["perk.late", "perk.drink"] }
];

export function tierFor(completedStays: number): { name: TierName; pct: number; perks: string[] } {
  if (completedStays >= 5) return { name: "Kestrel", pct: 10, perks: ["perk.late", "perk.drink"] };
  if (completedStays >= 2) return { name: "Heron", pct: 5, perks: ["perk.late"] };
  return { name: "Wren", pct: 0, perks: [] };
}

/** Discounted room amount from a priced room's night lines (base for statements). */
export function roomAmountOf(lines: PriceLine[]): number {
  let x = 0;
  for (const l of lines) {
    if (l.key === "breakfast") continue;
    if (l.key === "vat" || l.key === "city_tax" || l.key === "tourism_levy" || l.key === "night_total") continue;
    x += l.minor;
  }
  return x;
}

export { daysBetween };
