import { COPY, say } from './copy.js';
import type { Language } from './privateCopy.js';
import {
  compare,
  decimalPlaces,
  isPositive,
  parseDecimal,
  rational,
  toFixedHalfUp,
} from './rational.js';
import type { Rational } from './rational.js';
import { framesFromSeconds, readingFrames } from './timecode.js';
import type { FrameRate } from './timecode.js';
import { daysBetweenIso, longDateFromIso } from './time.js';

/** Four capital letters, seven capital letters or digits, then H or D. */
export function adIdProblem(adId: string): string | null {
  if (/^[A-Z]{4}[A-Z0-9]{7}[HD]$/.test(adId)) return null;
  if (/^[A-Z]{4}[A-Z0-9]{7}.$/u.test(adId) && [...adId].length === 12) return COPY.adIdEnding;
  return COPY.adIdShape;
}

/** Which decimal point each language's form uses, with Arabic taking either. */
export function parseSuggestedLength(text: string, language: Language): Rational | null {
  const western = language === 'ar' ? text.replace(/[٠-٩]/gu, digitOf).replace('٫', '.') : text;
  const point: '.' | ',' = language === 'nl' || language === 'fr' ? ',' : '.';
  const value = parseDecimal(western, point);
  if (value === null) return null;
  const plain = point === ',' ? western.replace(',', '.') : western;
  if (decimalPlaces(plain) > 3) return null;
  if (!isPositive(value)) return null;
  if (compare(value, rational(60)) > 0) return null;
  return value;
}

function digitOf(arabicDigit: string): string {
  return String('٠١٢٣٤٥٦٧٨٩'.indexOf(arabicDigit));
}

/** Stored exactly as `1.5`, shown in frames at the job's rate. */
export function suggestedLength(
  text: string,
  language: Language,
  rate: FrameRate,
): { seconds: string; frames: number } | null {
  const value = parseSuggestedLength(text, language);
  if (value === null) return null;
  const plain = value.d === 1n ? `${value.n}` : trimDecimal(toFixedHalfUp(value, 3));
  return { seconds: plain, frames: framesFromSeconds(value, rate) };
}

function trimDecimal(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** The safe area is 5 to 95 on both axes; the message prints the largest distance outside. */
export function safeAreaProblem(line: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string | null {
  const overflows = [
    5 - line.x,
    5 - line.y,
    line.x + line.width - 95,
    line.y + line.height - 95,
  ];
  const worst = Math.max(...overflows);
  if (worst <= 0) return null;
  return say.lineOutside(toFixedHalfUp(rational(Math.round(worst * 1000), 1000), 1));
}

export function readingTimeProblem(
  text: string,
  framesOnScreen: number,
  rate: FrameRate,
): string | null {
  const words = text.split(/\s+/u).filter((word) => word.length > 0).length;
  const needed = readingFrames(words, rate);
  return framesOnScreen < needed ? say.lineReading(needed, framesOnScreen) : null;
}

/** Licence state counts dates in the market's local wall time. */
export function licenceText(untilDate: string, todayInMarket: string): string {
  const days = daysBetweenIso(todayInMarket, untilDate);
  if (days < 0) return say.licenceEnded(longDateFromIso(untilDate));
  if (days === 0) return say.licenceEndsToday();
  return say.licenceEndsInDays(days);
}

export function licenceHasEnded(untilDate: string, todayInMarket: string): boolean {
  return daysBetweenIso(todayInMarket, untilDate) < 0;
}

export type CutFrame = {
  number: number;
  position: number;
  durationFrames: number;
  sha256: string | null;
};

/**
 * Frames listed by position in the newer cut (moved, then length, then drawing),
 * then gone frames by number.
 */
export function differences(older: readonly CutFrame[], newer: readonly CutFrame[]): string[] {
  const olderByNumber = new Map(older.map((frame) => [frame.number, frame]));
  const newerByNumber = new Map(newer.map((frame) => [frame.number, frame]));
  const lines: string[] = [];
  for (const frame of [...newer].sort((a, b) => a.position - b.position)) {
    const before = olderByNumber.get(frame.number);
    if (!before) {
      lines.push(say.isNew(frame.number));
      continue;
    }
    if (before.position !== frame.position) {
      lines.push(say.movedFrom(frame.number, before.position, frame.position));
    }
    if (before.durationFrames !== frame.durationFrames) {
      const change = frame.durationFrames - before.durationFrames;
      lines.push(
        change < 0
          ? say.shorter(frame.number, -change)
          : say.longer(frame.number, change),
      );
    }
    if (before.sha256 !== frame.sha256) lines.push(say.newDrawing(frame.number));
  }
  for (const frame of [...older].sort((a, b) => a.number - b.number)) {
    if (!newerByNumber.has(frame.number)) lines.push(say.isGone(frame.number));
  }
  return lines;
}
