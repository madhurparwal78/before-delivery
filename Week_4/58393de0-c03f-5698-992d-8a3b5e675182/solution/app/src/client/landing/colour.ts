import { mixHex } from "../render/palette";

/** Mixes a #rrggbb colour toward white (amount > 0) or black (amount < 0), for lit and shaded faces and pale grid lines. */
export function tint(hex: string, amount: number): string {
  return mixHex(hex, amount >= 0 ? "#ffffff" : "#000000", Math.abs(amount));
}

/** A design token's value, read from the page's custom properties so the scenes share the stylesheet's palette. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
