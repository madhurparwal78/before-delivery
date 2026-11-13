// Weekly maintenance windows in an IANA zone (Business rules L), evaluated on the server clock.
import { resolveWall, wallTimeAt } from "../../shared/zone";

export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_MS = 86_400_000;

export interface MaintenanceWindow {
  id: number;
  name: string;
  timeZone: string;
  days: string[];
  start: string;
  durationMs: number;
  ruleId: number;
}

/** The instant a window starts on the local calendar day `daysFromT` days after the day holding `t`. */
function startOnDay(window: MaintenanceWindow, t: number, daysFromT: number): { start: number; day: string } {
  const wall = wallTimeAt(window.timeZone, t);
  const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + daysFromT));
  const [hour = "0", minute = "0"] = window.start.split(":");
  const start = resolveWall(window.timeZone, {
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: Number(hour), minute: Number(minute), second: 0,
  });
  return { start, day: WEEK_DAYS[(date.getUTCDay() + 6) % 7] as string };
}

/** At `t`, on one of the window's days, its local start is at or before `t` and `t` is before start plus duration. */
export function windowActiveAt(window: MaintenanceWindow, t: number): boolean {
  const back = Math.ceil(window.durationMs / DAY_MS) + 1;
  for (let k = 0; k <= back; k++) {
    const { start, day } = startOnDay(window, t, -k);
    if (window.days.includes(day) && start <= t && t < start + window.durationMs) return true;
  }
  return false;
}

/** The first window start after `t`, or null when the window has no days. */
export function nextStart(window: MaintenanceWindow, t: number): number | null {
  for (let k = 0; k <= 8; k++) {
    const { start, day } = startOnDay(window, t, k);
    if (window.days.includes(day) && start > t) return start;
  }
  return null;
}

