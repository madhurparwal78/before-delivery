// Light budget (brief: Business rules, Light budget).
export type LuxStatus = "within" | "over";

export interface RunCalendar {
  runStart: string;
  runEnd: string;
  openHoursPerDay: number;
  closedWeekdays: number[];
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Days from runStart to runEnd inclusive that are not closed weekdays (calendar dates in the museum). */
function openDays(run: RunCalendar): number {
  const start = Date.parse(`${run.runStart}T00:00:00Z`);
  const end = Date.parse(`${run.runEnd}T00:00:00Z`);
  let days = 0;
  for (let t = start; t <= end; t += 86_400_000) {
    if (!run.closedWeekdays.includes(new Date(t).getUTCDay())) days += 1;
  }
  return days;
}

export function openHours(run: RunCalendar): number {
  return run.openHoursPerDay * openDays(run);
}

interface LuxFigures {
  plannedLux: number;
  plannedLuxHours: number;
  luxStatus: LuxStatus;
}

export function luxFigures(wallLux: number, hours: number, luxLimit: number, luxHourBudget: number): LuxFigures {
  const plannedLuxHours = wallLux * hours;
  const over = wallLux > luxLimit || plannedLuxHours > luxHourBudget;
  return { plannedLux: wallLux, plannedLuxHours, luxStatus: over ? "over" : "within" };
}
