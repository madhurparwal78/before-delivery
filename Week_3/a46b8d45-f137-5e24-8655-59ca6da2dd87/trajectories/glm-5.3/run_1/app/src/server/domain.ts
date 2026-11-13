// The desk's domain rules. Each rule is decided in exactly one place here.
import {
  addCalendarMonths, addDays, londonDateOf, londonLocalInstant, londonMidnight,
  weekdayOf, isRealDate,
} from './clock.js';
import type { DeskConfig } from './config.js';

export type ClaimState =
  | 'started' | 'confirmed' | 'identified' | 'quoted'
  | 'declined' | 'dispatched' | 'closed' | 'erased';

export const STATE_NAMES: Record<ClaimState, string> = {
  started: 'Started', confirmed: 'Confirmed', identified: 'Identified',
  quoted: 'Quoted', declined: 'Declined', dispatched: 'Dispatched',
  closed: 'Closed', erased: 'Erased',
};

/** The state machine. Every move outside it is refused with 409. */
const TRANSITIONS: Record<string, Record<string, ClaimState>> = {
  confirm: { started: 'confirmed' },
  identify: { confirmed: 'identified' },
  quote: { identified: 'quoted' },
  requote: { quoted: 'quoted' },
  payment: { quoted: 'quoted' },
  decline: { quoted: 'declined' },
  dispatch: { quoted: 'dispatched' },
  close: { declined: 'closed', dispatched: 'closed' },
  withdrawLink: { confirmed: 'confirmed', identified: 'identified', quoted: 'quoted', declined: 'declined', dispatched: 'dispatched' },
  newLink: { confirmed: 'confirmed', identified: 'identified', quoted: 'quoted', declined: 'declined', dispatched: 'dispatched' },
  erase: {
    started: 'erased', confirmed: 'erased', identified: 'erased', quoted: 'erased',
    declined: 'erased', dispatched: 'erased', closed: 'erased',
  },
};

export function transition(action: string, state: ClaimState): ClaimState | null {
  const table = TRANSITIONS[action];
  if (!table) return null;
  const next = table[state];
  return next === undefined ? null : next;
}

export interface EditionRow {
  code: string;
  title: string;
  startsOn: string;
  standardMonths: number;
  clubMonths: number;
  ownerContributionPercent: number;
}

export interface RulingInput {
  confirmedAt: number;   // epoch ms
  purchaseDate: string;  // YYYY-MM-DD
  clubMember: boolean;
  editions: ReadonlyArray<EditionRow>;
  config: DeskConfig;
  claimStartedAt: number;
}

export interface Ruling {
  inside: boolean;
  edition: string;
  coverEndsAt: number;
  coverEndsOn: string;
  termMonths: number | null;
}

/** The one edition in force at an instant: the latest starts_on on or before
 * the business day of that instant. */
export function decidingEdition(instant: number, editions: ReadonlyArray<EditionRow>): EditionRow | null {
  const businessDay = londonDateOf(instant);
  let best: EditionRow | null = null;
  for (const e of editions) {
    if (e.startsOn <= businessDay) {
      if (best === null || e.startsOn > best.startsOn) best = e;
    }
  }
  return best;
}

/** The rule that an instant at or after a closing instant is outside
 * (used for the cover end and for the confirmation link). */
export function instantIsBeforeClose(instant: number, closeInstant: number): boolean {
  return instant < closeInstant;
}

export function coverEndInstant(input: RulingInput): { end: number; termMonths: number | null; edition: EditionRow | null } {
  const edition = decidingEdition(input.confirmedAt, input.editions);
  if (input.config.aftercareTermSecondsOverride !== null) {
    // Cover ends exactly that many seconds after the claim's start instant.
    return { end: input.claimStartedAt + input.config.aftercareTermSecondsOverride * 1000, termMonths: null, edition };
  }
  const termMonths = edition === null
    ? 0
    : (input.clubMember ? edition.clubMonths : edition.standardMonths);
  if (termMonths === 0) {
    // The anniversary is the purchase date itself, so cover ends at its start: outside.
    return { end: londonMidnight(input.purchaseDate), termMonths: 0, edition };
  }
  const anniversary = addCalendarMonths(input.purchaseDate, termMonths);
  return { end: londonMidnight(anniversary), termMonths, edition };
}

export function makeRuling(input: RulingInput): Ruling {
  const { end, termMonths, edition } = coverEndInstant(input);
  return {
    inside: instantIsBeforeClose(input.confirmedAt, end) && edition !== null,
    edition: edition === null ? '' : edition.code,
    coverEndsAt: end,
    coverEndsOn: londonDateOf(end),
    termMonths,
  };
}

/** Quote figures, worked out in one place. Round half-up to the whole penny. */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5 + 1e-9);
}

export interface QuoteFigures {
  partLineMinor: number;
  carriageMinor: number;
  totalMinor: number;
}

export function quoteFigures(unitPriceMinor: number, quantity: number, ownerContributionPercent: number, inside: boolean, carriageMinor: number): QuoteFigures {
  const percent = inside ? ownerContributionPercent : 100;
  const exact = unitPriceMinor * quantity * percent / 100;
  const partLineMinor = roundHalfUp(exact);
  return { partLineMinor, carriageMinor, totalMinor: partLineMinor + carriageMinor };
}

/** The dispatch promise, decided at quote time and stored with the revision. */
export interface PromiseInput {
  source: 'bin' | 'supplier';
  quoteInstant: number;
  businessDay: string;
  config: DeskConfig;
  bankHolidays: ReadonlySet<string>;
}

export interface DispatchPromise {
  kind: 'same_day' | 'later';
  date: string;
}

export function isWorkingDay(date: string, bankHolidays: ReadonlySet<string>): boolean {
  const wd = weekdayOf(date);
  return wd >= 1 && wd <= 5 && !bankHolidays.has(date);
}

export function nextWorkingDay(date: string, bankHolidays: ReadonlySet<string>): string {
  let d = addDays(date, 1);
  while (!isWorkingDay(d, bankHolidays)) d = addDays(d, 1);
  return d;
}

export function nthWorkingDayAfter(date: string, n: number, bankHolidays: ReadonlySet<string>): string {
  let d = date;
  let count = 0;
  while (count < n) {
    d = addDays(d, 1);
    if (isWorkingDay(d, bankHolidays)) count += 1;
  }
  return d;
}

export function dispatchPromise(input: PromiseInput): DispatchPromise {
  const cutoff = londonLocalInstant(input.businessDay, input.config.dispatchCutoffLocal);
  const beforeCutoff = input.quoteInstant < cutoff;
  const workingDay = isWorkingDay(input.businessDay, input.bankHolidays);
  if (input.source === 'bin' && workingDay && beforeCutoff) {
    return { kind: 'same_day', date: input.businessDay };
  }
  if (input.source === 'bin') {
    return { kind: 'later', date: nextWorkingDay(input.businessDay, input.bankHolidays) };
  }
  return { kind: 'later', date: nthWorkingDayAfter(input.businessDay, 3, input.bankHolidays) };
}

/** The photo type check: judged only by leading bytes and size. */
export type PhotoVerdict = { ok: true; contentType: 'image/jpeg' | 'image/png' | 'image/webp' } | { ok: false; code: 'not_a_photo' | 'too_large' };

export const PHOTO_MAX_BYTES = 8_000_000;

export function judgePhoto(bytes: Uint8Array): PhotoVerdict {
  if (bytes.length > PHOTO_MAX_BYTES) {
    // A file that is both not a photo and over the cap is reported as not_a_photo.
    if (!looksLikePhoto(bytes)) return { ok: false, code: 'not_a_photo' };
    return { ok: false, code: 'too_large' };
  }
  if (!looksLikePhoto(bytes)) return { ok: false, code: 'not_a_photo' };
  return { ok: true, contentType: sniffPhotoType(bytes) as 'image/jpeg' | 'image/png' | 'image/webp' };
}

function looksLikePhoto(bytes: Uint8Array): boolean {
  return sniffPhotoType(bytes) !== null;
}

export function sniffPhotoType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

/** Model name matching, in one place: code-suffix removal, normalisation,
 * retired names, and the unknown/ambiguous report. */
export function stripSupplierCode(name: string): string {
  const trimmed = name.trim();
  const m = /[ \t]*[-/ ]?[ \t]*([A-Za-z]{2,4})([0-9]{2,4})[ \t]*$/.exec(trimmed);
  if (m === null) return trimmed;
  // Remove the matched suffix, keeping any separator that preceded it.
  return trimmed.slice(0, m.index).trimEnd();
}

export function normaliseModelName(name: string): string {
  return name.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface ModelNameIndex {
  /** normalised name -> model slugs */
  byName: Map<string, string[]>;
}

export function buildModelIndex(models: ReadonlyArray<{ slug: string; name: string; retiredNames: readonly string[] }>): ModelNameIndex {
  const byName = new Map<string, string[]>();
  const add = (n: string, slug: string) => {
    const key = normaliseModelName(n);
    const list = byName.get(key) ?? [];
    if (!list.includes(slug)) list.push(slug);
    byName.set(key, list);
  };
  for (const m of models) {
    add(m.name, m.slug);
    for (const r of m.retiredNames) add(r, m.slug);
  }
  return { byName };
}

export type MatchResult = { kind: 'matched'; slug: string } | { kind: 'unknown' } | { kind: 'ambiguous' };

export function matchModelName(rawName: string, index: ModelNameIndex): MatchResult {
  const stripped = stripSupplierCode(rawName.trim());
  const key = normaliseModelName(stripped);
  if (key === '') return { kind: 'unknown' };
  const list = index.byName.get(key);
  if (list === undefined || list.length === 0) return { kind: 'unknown' };
  if (list.length > 1) return { kind: 'ambiguous' };
  return { kind: 'matched', slug: list[0] as string };
}

export function filenameForMessage(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] || name;
}

/** A UK postcode in any case and spacing; the area is the letters before its
 * first digit, in capitals. */
export function parseUkPostcode(value: string): { valid: boolean; area: string } {
  const compact = value.replace(/\s+/g, '');
  const m = /^([A-Za-z]{1,2})([0-9][0-9A-Za-z]?)\s*([0-9])([A-Za-z]{2})$/.exec(compact);
  if (!m || m[1] === undefined) return { valid: false, area: '' };
  return { valid: true, area: m[1].toUpperCase() };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const REFERENCE_RE = /^HG-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/;
export const REFERENCE_CHARS = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const EDITION_CODE_RE = /^[A-Z0-9-]{3,20}$/;
export const ID_KEY_RE = /^[\x21-\x7E]{1,64}$/;

export function isRealDateChecked(date: string): boolean {
  return isRealDate(date);
}
export { isRealDate };
