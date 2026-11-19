import { CATEGORIES, type Category, type Constellation, type Tallies } from "../../shared/api.js";
import { NIGHTS } from "./time.js";

const HALO_MIN_PX = 12;
const HALO_SPAN_PX = 36;
const PHRASE_MAX = 200;

interface StoredSign {
  category: Category;
  nightKey: string;
}

export function tallies(signs: readonly { category: Category }[]): Tallies {
  const counts: Tallies = { inner_awareness: 0, action: 0, form: 0, context: 0 };
  for (const sign of signs) counts[sign.category] += 1;
  return counts;
}

/** 12 + 36 × min(nights, 28) / 28, rounded to the nearest whole pixel with halves up. */
function haloRadius(taggedNights: number): number {
  const numerator = HALO_MIN_PX * NIGHTS + HALO_SPAN_PX * Math.min(taggedNights, NIGHTS);
  return Math.floor((2 * numerator + NIGHTS) / (2 * NIGHTS));
}

export function constellations(signs: readonly StoredSign[]): Constellation[] {
  return CATEGORIES.map((category) => {
    const own = signs.filter((sign) => sign.category === category);
    const taggedNights = new Set(own.map((sign) => sign.nightKey)).size;
    return { category, stars: own.length, tagged_nights: taggedNights, halo_px: haloRadius(taggedNights) };
  });
}

/** The category with the most signs; ties go to the earlier category; null without signs. */
export function targetCategory(counts: Tallies): Category | null {
  let best: Category | null = null;
  for (const category of CATEGORIES) {
    if (counts[category] > 0 && (best === null || counts[category] > counts[best])) best = category;
  }
  return best;
}

/** A tag range is valid when it covers 1 to 200 UTF-16 code units of the text, at least one of them not a space. */
export function isPhraseRange(text: string, start: unknown, end: unknown): start is number {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    typeof start === "number" &&
    typeof end === "number" &&
    start >= 0 &&
    end - start >= 1 &&
    end - start <= PHRASE_MAX &&
    end <= text.length &&
    /\S/.test(text.slice(start, end))
  );
}
