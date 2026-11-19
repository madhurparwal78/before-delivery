import { ClockChangeRow } from "./db.js";
import { DAY_MS, fromUtcString, toShipDate } from "../shared/time.js";

/**
 * The vessel's offset timeline: the initial offset plus one step per clock
 * change. A single instance answers every "what offset applies at instant X"
 * and "which ship's day holds instant X" question.
 */
export class ShipTimeline {
  /** Clock-change instants in ascending order, strictly. */
  private changeInstants: number[] = [];
  private offsetsAfter: number[] = [];
  private readonly initialOffset: number;
  readonly rows: ClockChangeRow[];

  constructor(initialOffsetMinutes: number, changes: ClockChangeRow[]) {
    this.initialOffset = initialOffsetMinutes;
    this.rows = [...changes].sort((a, b) => a.changes_at_utc.localeCompare(b.changes_at_utc));
    let current = initialOffsetMinutes;
    for (const change of this.rows) {
      this.changeInstants.push(fromUtcString(change.changes_at_utc)!);
      current = change.new_offset_minutes;
      this.offsetsAfter.push(current);
    }
  }

  /** Offset in force at an instant: the last change at or before it, else the initial. */
  offsetAt(ms: number): number {
    let offset = this.initialOffset;
    for (let i = 0; i < this.changeInstants.length; i++) {
      if (this.changeInstants[i]! <= ms) offset = this.offsetsAfter[i]!;
      else break;
    }
    return offset;
  }

  /** Offset in force strictly before an instant (the clock reading just before it). */
  offsetJustBefore(ms: number): number {
    let offset = this.initialOffset;
    for (let i = 0; i < this.changeInstants.length; i++) {
      if (this.changeInstants[i]! < ms) offset = this.offsetsAfter[i]!;
      else break;
    }
    return offset;
  }

  /** The ship's date of an instant: date of instant + offset in force. */
  shipDateOf(ms: number): string {
    return toShipDate(ms + this.offsetAt(ms) * 60_000);
  }

  /** The UTC instant a ship's day `YYYY-MM-DD` starts at, i.e. its local midnight. */
  dayStartUtc(shipDate: string): number {
    // Binary search over instants would work, but the changes list is tiny; scan from the end.
    // A day's midnight in UTC is: date 00:00 UTC minus offset in force at that instant.
    // Iterating because the offset at the derived instant must be self-consistent.
    const base = fromUtcString(`${shipDate}T00:00:00Z`)!;
    let guess = base - this.offsetAt(base) * 60_000;
    for (let i = 0; i < this.changeInstants.length + 2; i++) {
      const offset = this.offsetAt(guess);
      const next = base - offset * 60_000;
      if (next === guess) return guess;
      guess = next;
    }
    return guess;
  }

  /** The day containing an instant, as its start instant. */
  dayStartOf(ms: number): number {
    return this.dayStartUtc(this.shipDateOf(ms));
  }

  /** The end instant of the ship's day containing `ms` (the next day's start). */
  dayEndOf(ms: number): number {
    return this.dayStartUtc(addOneDay(this.shipDateOf(ms)));
  }

  /** Ship's-date cell count: 48 plus the day's length change from clock changes inside it. */
  cellCountOf(shipDate: string): number {
    const start = this.dayStartUtc(shipDate);
    const nextStart = this.dayStartUtc(addOneDay(shipDate));
    const elapsedMs = nextStart - start;
    return Math.round(elapsedMs / (30 * 60 * 1000));
  }

  /** The half-hour cells of a ship's date, as UTC start instants. */
  cellsOf(shipDate: string): number[] {
    const start = this.dayStartUtc(shipDate);
    const nextStart = this.dayStartUtc(addOneDay(shipDate));
    const cells: number[] = [];
    for (let t = start; t < nextStart; t += 30 * 60 * 1000) cells.push(t);
    return cells;
  }

  /**
   * For a cell start instant, whether a retard inside this day makes this clock
   * time occur twice. The second pass carries `repeated` on the grid.
   */
  isSecondPassOfRetard(ms: number): boolean {
    // The cell's clock time equals an earlier cell's clock time only when a retard
    // between them lowered the offset. Find whether some earlier cell in the same
    // ship's date shares this instant's clock reading.
    const shipDate = this.shipDateOf(ms);
    const start = this.dayStartUtc(shipDate);
    if (ms <= start) return false;
    const myClock = ms + this.offsetAt(ms) * 60_000;
    for (let t = start; t < ms; t += 30 * 60 * 1000) {
      if (t + this.offsetAt(t) * 60_000 === myClock) return true;
    }
    return false;
  }

  /** Whether a retard makes the ship-time `HH:MM` on `shipDate` occur twice. */
  shipTimeOccursTwice(shipDate: string, minutes: number): boolean {
    const dayStart = this.dayStartUtc(shipDate);
    const dayEnd = this.dayStartUtc(addOneDay(shipDate));
    let count = 0;
    for (let t = dayStart; t < dayEnd; t += 30 * 60 * 1000) {
      const clockTime = t + this.offsetAt(t) * 60_000;
      if (toShipDate(clockTime) === shipDate && utcMinutesOf(clockTime) === minutes) {
        count++;
      }
    }
    return count >= 2;
  }

  /** The first instant of a ship-time on a ship's date (for a start time repeated by a retard). */
  firstInstantOfShipTime(shipDate: string, minutes: number): number | null {
    const dayStart = this.dayStartUtc(shipDate);
    const dayEnd = this.dayStartUtc(addOneDay(shipDate));
    for (let t = dayStart; t < dayEnd; t += 30 * 60 * 1000) {
      const clockTime = t + this.offsetAt(t) * 60_000;
      if (toShipDate(clockTime) === shipDate && utcMinutesOf(clockTime) === minutes) return t;
    }
    return null;
  }

  /** The last instant of a ship-time on a ship's date (for an end time repeated by a retard). */
  lastInstantOfShipTime(shipDate: string, minutes: number): number | null {
    const dayStart = this.dayStartUtc(shipDate);
    const dayEnd = this.dayStartUtc(addOneDay(shipDate));
    let found: number | null = null;
    for (let t = dayStart; t < dayEnd; t += 30 * 60 * 1000)  {
      const clockTime = t + this.offsetAt(t) * 60_000;
      if (toShipDate(clockTime) === shipDate && utcMinutesOf(clockTime) === minutes) found = t;
    }
    return found;
  }

  /**
   * The first instant after a skipped jump: for a time an advance removes, the
   * first half-hour instant at or after the target clock time.
   */
  instantAfterSkip(shipDate: string, minutes: number): number | null {
    const target = fromUtcString(`${shipDate}T${hhMm(minutes)}:00Z`)!;
    let t = target;
    const dayEnd = this.dayStartUtc(addOneDay(shipDate));
    while (t < dayEnd) {
      const clockTime = t + this.offsetAt(t) * 60_000;
      if (toShipDate(clockTime) === shipDate && utcMinutesOf(clockTime) >= minutes) return t;
      t += 30 * 60 * 1000;
    }
    return null;
  }

  /** The clock changes strictly inside a UTC interval. */
  changesBetween(startMs: number, endMs: number): ClockChangeRow[] {
    return this.rows.filter((c) => {
      const t = fromUtcString(c.changes_at_utc)!;
      return t > startMs && t < endMs;
    });
  }
}

function addOneDay(shipDate: string): string {
  const base = fromUtcString(`${shipDate}T00:00:00Z`)!;
  return toShipDate(base + DAY_MS);
}

function utcMinutesOf(ms: number): number {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function hhMm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
