// The working calendar: which calendar is in effect on a date, which days are counted, and where
// cycles start and end. Every other module asks this one for those decisions.
import type { Db } from "./db.js";
import { addDays, clockChange, isoInstant, isoWeekday, localDate, localMidnight, nowMs, type IsoDate } from "./time.js";

export interface Holiday {
  date: IsoDate;
  name: string;
}

export interface CalendarSave {
  seq: number;
  effective_date: IsoDate;
  time_zone: string;
  working_weekdays: number[];
  holidays: Holiday[];
  cycle_anchor: IsoDate;
}

export interface Day {
  date: IsoDate;
  counted: boolean;
  reason: string | null;
  clock_change: "forward" | "back" | null;
}

interface CycleSpan {
  number: number;
  startsMs: number;
  endsMs: number;
  starts_at: string;
  ends_at: string;
  days: Day[];
  first_working_date: IsoDate;
  last_working_date: IsoDate;
}

export const CYCLE_LENGTH = 10;

/** Counted-day rule for one calendar (also used to validate a submitted calendar). */
export function dayUnder(calendar: Pick<CalendarSave, "working_weekdays" | "holidays">, date: IsoDate): Pick<Day, "counted" | "reason"> {
  const holiday = calendar.holidays.find((h) => h.date === date);
  if (holiday) return { counted: false, reason: holiday.name };
  const weekday = isoWeekday(date);
  if (calendar.working_weekdays.includes(weekday)) return { counted: true, reason: null };
  return { counted: false, reason: weekday >= 6 ? "Weekend" : "Non-working day" };
}

export class WorkspaceCalendar {
  private readonly spans: CycleSpan[] = [];

  constructor(
    private readonly saves: CalendarSave[],
    readonly now: number = nowMs(),
  ) {}

  /** The latest save: the zone, anchor and holiday list in effect now. */
  get current(): CalendarSave {
    return this.saves[this.saves.length - 1] as CalendarSave;
  }

  get zone(): string {
    return this.current.time_zone;
  }

  /** The calendar in effect on `date`: the latest save whose effective date is on or before it. */
  inEffectOn(date: IsoDate): CalendarSave {
    for (let i = this.saves.length - 1; i >= 0; i--) {
      const save = this.saves[i] as CalendarSave;
      if (save.effective_date <= date) return save;
    }
    return this.saves[0] as CalendarSave;
  }

  day(date: IsoDate): Day {
    const calendar = this.inEffectOn(date);
    return { date, ...dayUnder(calendar, date), clock_change: clockChange(date, calendar.time_zone) };
  }

  midnight(date: IsoDate): number {
    return localMidnight(date, this.inEffectOn(date).time_zone);
  }

  instant(ms: number): string {
    return isoInstant(ms, this.zone);
  }

  today(): IsoDate {
    return localDate(this.now, this.zone);
  }

  nextCounted(after: IsoDate): IsoDate {
    let date = addDays(after, 1);
    while (!this.day(date).counted) date = addDays(date, 1);
    return date;
  }

  /** A due date on an uncounted day moves to the next counted day. */
  snap(date: IsoDate): { date: IsoDate; snapped: boolean } {
    if (this.day(date).counted) return { date, snapped: false };
    return { date: this.nextCounted(date), snapped: true };
  }

  private firstCountedFrom(date: IsoDate): IsoDate {
    return this.day(date).counted ? date : this.nextCounted(date);
  }

  /** Cycle `number` (1-based): ten counted days, tiled from the anchor with no gaps. */
  cycle(number: number): CycleSpan {
    while (this.spans.length < number) {
      const previous = this.spans[this.spans.length - 1];
      const first = previous ? this.nextCounted(previous.last_working_date) : this.firstCountedFrom(this.current.cycle_anchor);
      let last = first;
      for (let counted = 1; counted < CYCLE_LENGTH; counted++) last = this.nextCounted(last);
      const nextFirst = this.nextCounted(last);
      const days: Day[] = [];
      for (let date = first; date < nextFirst; date = addDays(date, 1)) days.push(this.day(date));
      const startsMs = this.midnight(first);
      const endsMs = this.midnight(nextFirst);
      this.spans.push({
        number: this.spans.length + 1,
        startsMs,
        endsMs,
        starts_at: isoInstant(startsMs, this.inEffectOn(first).time_zone),
        ends_at: isoInstant(endsMs, this.inEffectOn(nextFirst).time_zone),
        days,
        first_working_date: first,
        last_working_date: last,
      });
    }
    return this.spans[number - 1] as CycleSpan;
  }

  /** The cycle whose span holds instant `ms`; cycle 1 for instants before the anchor. */
  cycleAt(ms: number): number {
    for (let number = 1; ; number++) {
      const span = this.cycle(number);
      if (ms < span.endsMs) return number;
    }
  }

  currentNumber(): number {
    return this.cycleAt(this.now);
  }

  isFinished(number: number): boolean {
    return this.now >= this.cycle(number).endsMs;
  }
}

export async function loadCalendar(db: Db, workspaceId: string, now: number = nowMs()): Promise<WorkspaceCalendar> {
  const { rows } = await db.query<CalendarSave>(
    "SELECT seq, to_char(effective_date, 'YYYY-MM-DD') AS effective_date, time_zone, working_weekdays, holidays, to_char(cycle_anchor, 'YYYY-MM-DD') AS cycle_anchor FROM calendar_saves WHERE workspace_id = $1 ORDER BY seq",
    [workspaceId],
  );
  return new WorkspaceCalendar(rows, now);
}
