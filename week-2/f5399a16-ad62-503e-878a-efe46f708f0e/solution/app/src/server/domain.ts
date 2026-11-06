// Single-source domain rules that only the server decides.

import { foldedAscii } from '../shared/fold';
import { divFloor, divHalfUp, secondsCell, recordStartFrame, timecode, type FrameRate } from '../shared/timecode';
import { dateIn, TOWN_ZONES, wallToInstant, type Town } from '../shared/time';
import { config } from './config';
import { framesWithTimecode, type CutFrame } from './records';

// Private page lifetime ------------------------------------------------------------------------

export type PageKind = 'review' | 'signOff' | 'fee';

const PAGE_SECONDS: Record<PageKind, number> = {
  review: config.reviewPageSeconds,
  signOff: config.signOffPageSeconds,
  fee: config.feePageSeconds,
};

/** 23:59:59 producer wall time on the due date, or the page's seconds after sending, whichever comes first. */
export function pageEndsAt(kind: PageKind, dueDate: string, town: Town, now: number): number {
  const lastMinute = wallToInstant(dueDate, '23:59', TOWN_ZONES[town]) as number;
  return Math.min(lastMinute + 59_000, now - (now % 1000) + PAGE_SECONDS[kind] * 1000);
}

/** The due date has passed once the producer's own date is after it. */
export function dueDatePassed(dueDate: string, town: Town, now: number): boolean {
  return dateIn(now, TOWN_ZONES[town]) > dueDate;
}

export function pageEnded(page: { ended_at: Date | null; ends_at: Date }, now: number): boolean {
  return page.ended_at !== null || page.ends_at.getTime() <= now;
}

// Suggested lengths ----------------------------------------------------------------------------

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** A length typed the local way, to its `.` form; null when that language refuses it. */
export function parseLength(language: string, typed: unknown): string | null {
  if (typeof typed !== 'string') return null;
  let plain = typed.trim();
  if (language === 'nl' || language === 'fr') {
    if (plain.includes('.')) return null;
    plain = plain.replace(',', '.');
  } else if (language === 'ar') {
    plain = Array.from(plain, (c) => (ARABIC_DIGITS.includes(c) ? String(ARABIC_DIGITS.indexOf(c)) : c === '٫' ? '.' : c)).join('');
  }
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(plain);
  if (!match) return null;
  const thousandths = BigInt((match[1] as string) + (match[2] ?? '').padEnd(3, '0'));
  return thousandths > 0n && thousandths <= 60_000n ? plain : null;
}

// Money ----------------------------------------------------------------------------------------

const TAX_PERCENT: Record<string, number> = { netherlands: 21, ontario: 13, newYork: 0, dubai: 0 };
const CURRENCY_MARK: Record<string, string> = { EUR: '€', CAD: 'CA$', USD: 'US$' };

export function feeToMinor(fee: unknown): number | null {
  if (typeof fee !== 'string') return null;
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(fee);
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return minor > 0 ? minor : null;
}

export function moneyText(currency: string, minor: number): string {
  const whole = String(divFloor(minor, 100)).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${CURRENCY_MARK[currency]}${whole}.${String(minor % 100).padStart(2, '0')}`;
}

export interface Milestone {
  number: number;
  amountMinor: number;
  taxMinor: number;
}

/** Three milestones summing to the fee, earlier ones taking the extra cents; tax half up on each. */
export function splitFee(feeMinor: number, place: string): { milestones: Milestone[]; taxMinor: number } {
  const base = divFloor(feeMinor, 3);
  const extra = feeMinor % 3;
  const percent = TAX_PERCENT[place] as number;
  const milestones = [1, 2, 3].map((number) => {
    const amountMinor = base + (number <= extra ? 1 : 0);
    return { number, amountMinor, taxMinor: divHalfUp(amountMinor * percent, 100) };
  });
  return { milestones, taxMinor: milestones.reduce((sum, m) => sum + m.taxMinor, 0) };
}

// Delivery files -------------------------------------------------------------------------------

export function editDecisionList(title: string, frames: CutFrame[], rate: FrameRate): string {
  const lines = [`TITLE: ${foldedAscii(title).slice(0, 70)}`, rate === '29.97' ? 'FCM: DROP FRAME' : 'FCM: NON-DROP FRAME', ''];
  const start = recordStartFrame(rate);
  framesWithTimecode(frames, rate).forEach(({ frame, startFrame }, index) => {
    const event = String(index + 1).padStart(3, '0');
    const times = [timecode(0, rate), timecode(frame.durationFrames, rate), timecode(start + startFrame, rate), timecode(start + startFrame + frame.durationFrames, rate)];
    lines.push(`${event}  AX       V     C        ${times.join(' ')}`);
    lines.push(`* FROM CLIP NAME: ${foldedAscii(frame.fileName as string)}`);
  });
  return `${lines.join('\r\n')}\r\n`;
}

function shotCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function shotList(frames: CutFrame[], rate: FrameRate): string {
  const lines = ['position,frame,timecodeIn,seconds,shot,visual,audio,actionNote'.split(',').map(shotCell).join(',')];
  for (const { frame, timecodeIn } of framesWithTimecode(frames, rate)) {
    lines.push(
      [String(frame.position), String(frame.number), timecodeIn, secondsCell(frame.durationFrames, rate), frame.shot, frame.visual, frame.audioNote, frame.actionNote]
        .map(shotCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

// Calendar files -------------------------------------------------------------------------------

function calendarText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
function foldCalendarLine(line: string): string {
  const pieces: string[] = [];
  let current = '';
  let octets = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (octets + size > 75) {
      pieces.push(current);
      current = ' ';
      octets = 1;
    }
    current += character;
    octets += size;
  }
  pieces.push(current);
  return pieces.join('\r\n');
}

function calendarInstant(at: number): string {
  return new Date(at).toISOString().replace(/[-:]|\.\d+/g, '');
}

interface CalendarCall {
  uid: string;
  sequence: number;
  producerName: string;
  producerEmail: string;
  note: string;
  startsAt: number;
  endsAt: number;
}

export function calendarFile(call: CalendarCall, method: 'REQUEST' | 'CANCEL', now: number): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Noor Bakker Boards//Clapstick//EN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${call.uid}`,
    `SEQUENCE:${call.sequence}`,
    `DTSTAMP:${calendarInstant(now)}`,
    `DTSTART:${calendarInstant(call.startsAt)}`,
    `DTEND:${calendarInstant(call.endsAt)}`,
    `SUMMARY:Call with ${calendarText(call.producerName)}`,
    `DESCRIPTION:${calendarText(call.note)}`,
    `ORGANIZER:mailto:${config.mailAddress}`,
    `ATTENDEE:mailto:${call.producerEmail}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldCalendarLine).join('\r\n')}\r\n`;
}

