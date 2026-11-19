/**
 * Scroll-linked rules in one place: the 40% current-section line, the 60%
 * milestone line, the 75% counter line and the copy drift. Every rule is
 * evaluated on scroll and resize events only, never on observers.
 */
import { currentSection } from "../shared/domain.js";
import { viewportUnder768, prefersReducedMotion } from "./core.js";

export type SectionOffsets = Map<string, number>;

export function sectionTop(id: string): number {
  const element = document.getElementById(id);
  if (!element) return Number.POSITIVE_INFINITY;
  return element.getBoundingClientRect().top + window.scrollY;
}

export function collectOffsets(ids: readonly string[]): SectionOffsets {
  const offsets: SectionOffsets = new Map();
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) offsets.set(id, element.getBoundingClientRect().top + window.scrollY);
  }
  return offsets;
}

export function currentAtLine(
  ids: readonly string[],
  lineAt: number
): string | null {
  return currentSection(ids, collectOffsets(ids), window.scrollY + lineAt);
}

export function line40(): number {
  return window.scrollY + window.innerHeight * 0.4;
}

export function line60(): number {
  return window.scrollY + window.innerHeight * 0.6;
}

export function line75(): number {
  return window.scrollY + window.innerHeight * 0.75;
}

export function line90(): number {
  return window.scrollY + window.innerHeight * 0.9;
}

/** copy drift: round(0.3 × min(s, 600)) px upward, 0 below 768 px and with reduced motion */
export function copyDrift(scrollY: number): number {
  if (viewportUnder768() || prefersReducedMotion()) return 0;
  return Math.round(0.3 * Math.min(scrollY, 600));
}

/** tilt: clamped to ±12 whole degrees, halves rounding away from zero */
export function tiltAngles(
  pointerX: number,
  pointerY: number,
  box: DOMRect
): { x: number; y: number } {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const x = clampDegrees((-12 * (pointerY - cy)) / (box.height / 2));
  const y = clampDegrees((12 * (pointerX - cx)) / (box.width / 2));
  return { x, y };
}

function clampDegrees(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value) + 0.000001);
  const exact = Math.abs(value % 1) === 0.5 ? (Math.sign(value) * Math.ceil(Math.abs(value))) : rounded;
  return Math.max(-12, Math.min(12, exact));
}

