// Measurements: stored in whole centimetres, typed in either unit, shown in both.

import { halfUp } from "./arith.js";

/** Inches × 2.54 rounded half up to a centimetre. */
export function inchesToCm(inches: number): number {
  return halfUp(Math.round(inches * 100) * 254, 10_000);
}

/** Centimetres ÷ 2.54 rounded half up to a whole inch. */
export function cmToInches(cm: number): number {
  return halfUp(cm * 100, 254);
}

export function feetAndInches(cm: number): string {
  const inches = cmToInches(cm);
  return `${Math.floor(inches / 12)} ft ${inches % 12} in`;
}

/** `173 cm / 5 ft 8 in`. */
export function heightBoth(cm: number): string {
  return `${cm} cm / ${feetAndInches(cm)}`;
}

/** `84 cm / 33 in`. */
export function girthBoth(cm: number): string {
  return `${cm} cm / ${cmToInches(cm)} in`;
}

export type Unit = "cm" | "ft_in";

export function heightIn(cm: number, unit: Unit): string {
  return unit === "cm" ? `${cm} cm` : feetAndInches(cm);
}

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;

/**
 * Height text: `5'9"`, `5' 9"`, `5 ft 9 in`, `69 in`, `175 cm`, `175` (centimetres) or `1.75 m`.
 * Returns whole centimetres or null.
 */
export function parseHeight(text: string): number | null {
  const value = text.trim().toLowerCase();
  let match = new RegExp(String.raw`^(\d+)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$`).exec(value);
  if (match) return inchesToCm(Number(match[1]) * 12 + Number(match[2] ?? 0));
  match = new RegExp(String.raw`^${NUMBER}\s*(?:"|in|inches)$`).exec(value);
  if (match) return inchesToCm(Number(match[1]));
  match = new RegExp(String.raw`^${NUMBER}\s*m$`).exec(value);
  if (match) return Math.round(Number(match[1]) * 100);
  match = new RegExp(String.raw`^${NUMBER}\s*(?:cm)?$`).exec(value);
  if (match) return Math.round(Number(match[1]));
  return null;
}

/** Chest, waist or hips text: `34"`, `34 in`, `86 cm` or `86` (centimetres). */
export function parseGirth(text: string): number | null {
  const value = text.trim().toLowerCase();
  let match = new RegExp(String.raw`^${NUMBER}\s*(?:"|in|inches)$`).exec(value);
  if (match) return inchesToCm(Number(match[1]));
  match = new RegExp(String.raw`^${NUMBER}\s*(?:cm)?$`).exec(value);
  if (match) return Math.round(Number(match[1]));
  return null;
}
