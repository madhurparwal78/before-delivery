// Domain rules shared by the server (which decides) and the browser (which previews and formats).
// Every rule lives here once: piece status, cuts and take, board feet, price, invoice lines,
// imperial conversion, snap marks and the display formats.

export const SPECIES = ["Black walnut", "Chestnut", "Douglas fir", "Heart pine", "White oak"] as const;
export const GRADES = ["Select", "Character", "Rustic"] as const;
export const DEFECT_KINDS = ["nail hole", "check", "bolt hole"] as const;
export const BOARD_STATUSES = ["tagged", "graded", "available", "held", "sold-whole", "cut"] as const;
export const OPEN_STATUSES = ["tagged", "graded", "available", "held"] as const;

export type Species = (typeof SPECIES)[number];
export type Grade = (typeof GRADES)[number];
export type DefectKind = (typeof DEFECT_KINDS)[number];
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const DEPOSIT_CENTS = 2500;
export const KERF_ALLOWANCE_MM = 4;
export const KERF_MM = 3.2;
const MIN_OFFCUT_MM = 300;
const PIECE_GAP_MM = 10;
export const MAX_PIECES = 20;
export const GRADE_TALLY: Record<Grade, number> = { Select: 1, Character: 2, Rustic: 3 };

const BOARD_FOOT_MM3 = 2_359_737_216n; // cubic millimetres in 1000 board feet

export interface DefectZone {
  kind: DefectKind;
  start_mm: number;
  end_mm: number;
}

export interface Piece {
  label: string;
  length_mm: number;
  width_mm: number;
  start_mm: number;
}

export type PieceStatus = "clear" | "over defect" | "overlap" | "off board" | "too wide";
export type Sale = "cut" | "whole";

interface BoardShape {
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  defects: DefectZone[];
}

interface FitFigures {
  pieces: (Piece & { status: PieceStatus })[];
  clear_count: number;
  cuts_mm: number[];
  take_mm: number | null;
  sale: Sale | null;
  offcut_mm: number | null;
  clear_offcut_mm: number | null;
  board_feet: string | null;
  price_cents: number | null;
  verdict: string;
}

const pieceEnd = (p: Piece): number => p.start_mm + p.length_mm;

/** Spans are [start, end): a piece and a zone overlap when they share any millimetre. */
function spansShare(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function overDefect(piece: Piece, defects: readonly DefectZone[]): boolean {
  return defects.some((d) => spansShare(piece.start_mm, pieceEnd(piece), d.start_mm, d.end_mm));
}

function pieceStatuses(board: BoardShape, pieces: readonly Piece[]): PieceStatus[] {
  return pieces.map((p, i) => {
    if (pieceEnd(p) > board.length_mm) return "off board";
    if (p.width_mm > board.width_mm) return "too wide";
    const tooClose = pieces.some((q, j) => {
      if (j === i) return false;
      const gap = Math.max(p.start_mm, q.start_mm) - Math.min(pieceEnd(p), pieceEnd(q));
      return gap < PIECE_GAP_MM;
    });
    if (tooClose) return "overlap";
    if (overDefect(p, board.defects)) return "over defect";
    return "clear";
  });
}

function cutPositions(boardLength: number, pieces: readonly Piece[]): number[] {
  const ends = pieces.map(pieceEnd);
  const positions = new Set<number>();
  for (const p of pieces) {
    if (p.start_mm > 0 && !ends.includes(p.start_mm - PIECE_GAP_MM)) positions.add(p.start_mm);
  }
  for (const end of ends) if (end < boardLength) positions.add(end);
  return [...positions].sort((a, b) => a - b);
}

/** Longest stretch of [from, to) that no defect zone touches. */
export function longestClearRun(from: number, to: number, defects: readonly DefectZone[]): number {
  const zones = defects
    .map((d) => [Math.max(d.start_mm, from), Math.min(d.end_mm, to)] as const)
    .filter(([s, e]) => s < e)
    .sort((a, b) => a[0] - b[0]);
  let best = 0;
  let cursor = from;
  for (const [s, e] of zones) {
    if (s > cursor) best = Math.max(best, s - cursor);
    cursor = Math.max(cursor, e);
  }
  return Math.max(best, to - cursor, 0);
}

export function volumeMm3(thickness: number, width: number, length: number): number {
  return thickness * width * length;
}

function halfUpDivide(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** Board feet shown rounded half up to two decimals (display only). */
export function boardFeet(volume: number): string {
  const hundredths = halfUpDivide(BigInt(volume) * 100_000n, BOARD_FOOT_MM3);
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}

/** The one price formula: T × W × take × rate × 1000 ÷ 2,359,737,216, rounded half up once. */
export function priceCents(thickness: number, width: number, take: number, rateCents: number): number {
  const exact = BigInt(thickness) * BigInt(width) * BigInt(take) * BigInt(rateCents) * 1000n;
  return Number(halfUpDivide(exact, BOARD_FOOT_MM3));
}

export function fitLayout(board: BoardShape, pieces: readonly Piece[], rateCents: number | null): FitFigures {
  const statuses = pieceStatuses(board, pieces);
  const clearCount = statuses.filter((s) => s === "clear").length;
  const cuts = cutPositions(board.length_mm, pieces);
  const broken = statuses.some((s) => s === "off board" || s === "too wide" || s === "overlap");
  const withStatus = pieces.map((p, i) => ({ ...p, status: statuses[i] ?? "clear" }));
  const total = pieces.length;
  if (broken) {
    return {
      pieces: withStatus, clear_count: clearCount, cuts_mm: cuts, take_mm: null, sale: null, offcut_mm: null,
      clear_offcut_mm: null, board_feet: null, price_cents: null,
      verdict: `${clearCount} of ${total} cuts fit clear of defects, layout needs fixing`,
    };
  }
  const furthest = Math.max(...pieces.map(pieceEnd));
  const possibleOffcut = board.length_mm - furthest - KERF_ALLOWANCE_MM;
  const sale: Sale = possibleOffcut >= MIN_OFFCUT_MM ? "cut" : "whole";
  const take = sale === "cut" ? furthest : board.length_mm;
  const offcut = sale === "cut" ? possibleOffcut : null;
  const clearOffcut = sale === "cut"
    ? longestClearRun(take + KERF_ALLOWANCE_MM, board.length_mm, board.defects)
    : null;
  return {
    pieces: withStatus,
    clear_count: clearCount,
    cuts_mm: cuts,
    take_mm: take,
    sale,
    offcut_mm: offcut,
    clear_offcut_mm: clearOffcut,
    board_feet: boardFeet(volumeMm3(board.thickness_mm, board.width_mm, take)),
    price_cents: rateCents === null ? null : priceCents(board.thickness_mm, board.width_mm, take, rateCents),
    verdict: offcut === null
      ? `${clearCount} of ${total} cuts fit clear of defects, no offcut`
      : `${clearCount} of ${total} cuts fit clear of defects, offcut ${offcut} mm`,
  };
}

/** Floored shares by length, leftover cents to the largest remainders, ties to the earlier piece. */
export function invoiceLines(price: number, lengths: readonly number[]): number[] {
  const total = BigInt(lengths.reduce((a, b) => a + b, 0));
  const p = BigInt(price);
  const base = lengths.map((l) => (p * BigInt(l)) / total);
  const rems = lengths.map((l) => (p * BigInt(l)) % total);
  let left = Number(p - base.reduce((a, b) => a + b, 0n));
  const order = lengths.map((_, i) => i).sort((a, b) => {
    const ra = rems[a] ?? 0n;
    const rb = rems[b] ?? 0n;
    return ra === rb ? a - b : rb > ra ? 1 : -1;
  });
  const out = base.map(Number);
  for (const i of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/** Offcut defect zones: those inside [from, from + length), shifted to start at 0 and clipped. */
export function zonesWithin(defects: readonly DefectZone[], from: number, length: number): DefectZone[] {
  return defects
    .map((d) => ({ kind: d.kind, start_mm: Math.max(d.start_mm - from, 0), end_mm: Math.min(d.end_mm - from, length) }))
    .filter((d) => d.start_mm < d.end_mm);
}

// ---- units and formats ----

export type Unit = "mm" | "in";

/** A decimal-inch string ("23.625") to whole millimetres, exactly, rounded half away from zero. */
export function inchesToMm(text: string): number | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) return null;
  const digits = m[2] ?? "";
  const numerator = BigInt(`${m[1]}${digits}`) * 254n;
  const denominator = 10n ** BigInt(digits.length + 1);
  return Number(halfUpDivide(numerator, denominator));
}

/** Length shown to the nearest sixteenth of an inch, rounded half up, as `96 1/16 in`. */
function formatInches(mm: number): string {
  const sixteenths = Math.floor((320 * mm + 254) / 508);
  if (sixteenths <= 0) return "0 in";
  const whole = Math.floor(sixteenths / 16);
  let num = sixteenths % 16;
  let den = 16;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const parts: string[] = [];
  if (whole) parts.push(String(whole));
  if (num) parts.push(`${num}/${den}`);
  return `${parts.join(" ")} in`;
}

export function lengthText(mm: number, unit: Unit): string {
  return unit === "mm" ? `${mm} mm` : formatInches(mm);
}

/** Snap mark k: k × 10 mm, or k × 12.7 mm rounded half up, each computed from k directly. */
function snapMark(k: number, unit: Unit): number {
  return unit === "mm" ? k * 10 : Math.floor((254 * k + 10) / 20);
}

const markStep = (unit: Unit): number => (unit === "mm" ? 10 : 12.7);

export function nextMark(start: number, direction: 1 | -1, unit: Unit): number | null {
  let k = Math.floor(start / markStep(unit)) + (direction === 1 ? -1 : 2);
  for (;;) {
    const mark = snapMark(k, unit);
    if (direction === 1 && mark > start) return mark;
    if (direction === -1 && mark < start) return k < 0 ? null : mark;
    k += direction;
  }
}

/** The mark nearest a dragged position; exactly halfway goes to the larger mark. */
export function nearestMark(position: number, unit: Unit): number {
  const k = Math.floor(position / markStep(unit));
  let best = snapMark(Math.max(k - 1, 0), unit);
  for (const c of [k, k + 1, k + 2]) {
    const mark = snapMark(Math.max(c, 0), unit);
    if (Math.abs(mark - position) <= Math.abs(best - position)) best = mark;
  }
  return best;
}

export function money(cents: number): string {
  const whole = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${String(cents % 100).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2 Nov 2026, 14:05 UTC` — seconds dropped, never rounded. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export const BOARD_LABELS: Record<BoardStatus, string> = {
  tagged: "Tagged", graded: "Graded", available: "Available", held: "Held", "sold-whole": "Sold", cut: "Cut",
};

export type HoldStatus = "pending-payment" | "held" | "released" | "converted-to-sale";
export type ReleaseReason = "cancelled" | "expired" | "payment-failed";

export function holdLabel(status: HoldStatus, reason: ReleaseReason | null): string {
  if (status === "pending-payment") return "Pending";
  if (status === "held") return "Held";
  if (status === "converted-to-sale") return "Bought";
  return reason === "expired" ? "Expired" : "Released";
}

export type TicketStatus = "issued" | "at-saw" | "done";
export const TICKET_LABELS: Record<TicketStatus, string> = { issued: "Issued", "at-saw": "At saw", done: "Done" };

export function isSpecies(v: unknown): v is Species {
  return typeof v === "string" && (SPECIES as readonly string[]).includes(v);
}

export function isGrade(v: unknown): v is Grade {
  return typeof v === "string" && (GRADES as readonly string[]).includes(v);
}

export function isDefectKind(v: unknown): v is DefectKind {
  return typeof v === "string" && (DEFECT_KINDS as readonly string[]).includes(v);
}

/** Card numbers: 13–19 digits once spaces are removed, passing the Luhn check. */
export function validCardNumber(raw: string): boolean {
  const digits = raw.replace(/ /g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** A sign-in `next` is honoured only as a same-origin path starting with exactly one `/`. */
export function safeNext(target: string | null): string {
  if (target === null || target.length > 2048) return "/";
  let s = target;
  for (let round = 0; round < 3; round++) {
    if (/[\u0000-\u001f\u007f]/.test(s) || s.includes("\\") || !s.startsWith("/") || s.startsWith("//")) return "/";
    let decoded: string;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      return "/";
    }
    if (decoded === s) return target;
    s = decoded;
  }
  return "/";
}
