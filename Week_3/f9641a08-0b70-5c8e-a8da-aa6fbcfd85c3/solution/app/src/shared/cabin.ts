/** Luggage, backpacks and totes have a cabin fit (and a trial); wallets and accessories have neither. */
const CABIN_CATEGORIES = ["luggage", "backpacks", "totes"];

export function hasCabinFit(category: string): boolean {
  return CABIN_CATEGORIES.includes(category);
}
