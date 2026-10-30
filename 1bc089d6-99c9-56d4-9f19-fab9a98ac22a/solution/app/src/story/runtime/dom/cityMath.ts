import { city } from "../../content";

const DARK_FROM = 0.18;
const DARK_TO = 0.82;
const SECOND_CAPTION_AT = 0.4;

/** Windows still lit at the city window's progress p: 4,096 up to 0.18, one from 0.82, linear between. */
export function litCount(p: number) {
  if (p <= DARK_FROM) return city.windows;
  if (p >= DARK_TO) return 1;
  return Math.round(city.windows - (city.windows - 1) * ((p - DARK_FROM) / (DARK_TO - DARK_FROM)));
}

/** Which caption shows: 0 "The offices close." → 1 "The kitchens go quiet." → 2 "One window left." */
export function cityCaption(p: number) {
  if (p < SECOND_CAPTION_AT) return 0;
  if (p < DARK_TO) return 1;
  return 2;
}

export function litCopy(count: number) {
  return count === 1 ? "1 window lit" : `${count.toLocaleString("en-US")} windows lit`;
}
