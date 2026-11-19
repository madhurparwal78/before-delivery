import { addDays, ukDateString } from "./uktime.js";
import type { Pennies } from "./money.js";
import { fractionOf } from "./money.js";

export interface DutyBlock {
  kind: "drive" | "break" | "wait" | "rest";
  minutes: number;
}

export interface HoursAnswer {
  drivingMinutes: number;
  spreadMinutes: number;
  breaches: { rule: "drivingBeforeBreak" | "dailyDriving" | "spread"; atMinute: number; atLocal: { date: string; time: string } }[];
}

export interface RunDuty {
  startInstant: Date;
  blocks: DutyBlock[];
}

/** Judge a single run's own blocks: driving before break and spread, in real elapsed minutes. */
export function judgeSingleRun(duty: RunDuty, excludeSecondDriver: boolean): { drivingMinutes: number; spreadMinutes: number; breach: { rule: "drivingBeforeBreak" | "spread"; atMinute: number } | null } {
  let driving = 0;
  let spread = 0;
  for (const b of duty.blocks) spread += b.minutes;
  let sinceBreak = 0;
  let minute = 0;
  let driveStartMinute = 0;
  let breach: { rule: "drivingBeforeBreak" | "spread"; atMinute: number } | null = null;
  let split15 = false;
  let split30 = false;
  const clearBreak = () => {
    sinceBreak = 0;
    split15 = false;
    split30 = false;
  };
  for (const b of duty.blocks) {
    if (b.kind === "drive") {
      const before = sinceBreak;
      sinceBreak += b.minutes;
      driving += b.minutes;
      if (!excludeSecondDriver && !breach && before < 270 && sinceBreak > 270) {
        breach = { rule: "drivingBeforeBreak", atMinute: driveStartMinute + (270 - before + 1) };
      }
      driveStartMinute = minute + b.minutes;
      minute += b.minutes;
    } else {
      minute += b.minutes;
      if (b.kind === "break") {
        if (b.minutes >= 45) clearBreak();
        else if (b.minutes >= 30) {
          split30 = true;
          if (split15) clearBreak();
        } else if (b.minutes >= 15) {
          split15 = true;
          if (split30) clearBreak();
        }
      }
    }
  }
  if (!excludeSecondDriver && !breach && spread > 780) breach = { rule: "spread", atMinute: 781 };
  return { drivingMinutes: driving, spreadMinutes: spread, breach };
}

/** Local (UK) time label at an elapsed minute of a duty. */
export function localAtMinute(startInstant: Date, minute: number): { date: string; time: string } {
  const f = ukFieldsOf(startInstant, minute);
  return f;
}

function ukFieldsOf(start: Date, minute: number): { date: string; time: string } {
  const t = new Date(start.getTime() + minute * 60000);
  const d = ukDateString(t);
  const o = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
  return { date: d, time: o === "24:00" ? "00:00" : o };
}

/** Judge a run with the day and week driving rules in force. */
export function judgeRun(duty: RunDuty, secondDriver: boolean, sameDriverDayDriving: number, sameDriverWeekDaysOver540: number): HoursAnswer {
  const single = judgeSingleRun(duty, secondDriver);
  const breaches: HoursAnswer["breaches"] = [];
  if (single.breach) {
    const at = single.breach.atMinute;
    breaches.push({ rule: single.breach.rule, atMinute: at, atLocal: localAtMinute(duty.startInstant, at) });
  }
  if (!secondDriver) {
    const driving = single.drivingMinutes;
    const dayOthers = sameDriverDayDriving;
    const dayTotal = dayOthers + driving;
    if (dayTotal > 540) {
      const remaining = 540 - dayOthers;
      const at = remaining < 0 ? 1 : remaining + 1;
      if (driving > remaining) {
        breaches.push({ rule: "dailyDriving", atMinute: at, atLocal: localAtMinute(duty.startInstant, at) });
      }
    }
    void sameDriverWeekDaysOver540;
  }
  return { drivingMinutes: single.drivingMinutes, spreadMinutes: single.spreadMinutes, breaches };
}

/** Cancellation charge bands, UK calendar days between notice and departure. */
export function cancellationDays(departDate: string, noticeDate: string): number {
  const d = toDays(departDate);
  const n = toDays(noticeDate);
  return d - n;
}

function toDays(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return civil(y, m, d);
}

function civil(y: number, m: number, d: number): number {
  y += m <= 2 ? -1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function cancellationCharge(days: number, total: Pennies, deposit: Pennies): Pennies {
  let rate = 1;
  if (days >= 30) rate = 0;
  else if (days >= 15) rate = 0.25;
  else if (days >= 8) rate = 0.5;
  else rate = 1;
  if (rate === 0) return deposit;
  const pct = fractionOf(total, rate * 100);
  return Math.max(deposit, Math.min(total, pct));
}

/** Seat grid rows: 2+2 with aisle; the 8-seat 2+1; last row is whatever is left. */
export function seatGridFor(size: number): string[] {
  const seats: string[] = [];
  if (size === 8) {
    let row = 1;
    let col = 0;
    const cols = ["A", "B", "C"];
    for (let i = 0; i < size; i++) {
      seats.push(`${row}${cols[col]}`);
      col++;
      if (col === 3) {
        col = 0;
        row++;
      }
    }
    return seats;
  }
  const cols = ["A", "B", "C", "D"];
  let row = 1;
  let col = 0;
  for (let i = 0; i < size; i++) {
    seats.push(`${row}${cols[col]}`);
    col++;
    if (col === 4) {
      col = 0;
      row++;
    }
  }
  return seats;
}

export const WHEELCHAIR_SEATS = ["2A", "2B"];

export function adultsNeeded(pupils: number): number {
  return Math.ceil(pupils / 15);
}

export { addDays };
