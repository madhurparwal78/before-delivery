export interface Schedule {
  type: "manual" | "interval" | "cron";
  interval_minutes?: number;
  cron_expression?: string;
  time_zone?: string;
}

/** The zone a next run is written in: the connection's own cron zone, or UTC. */
export function scheduleZone(schedule: Schedule): string {
  return schedule.type === "cron" ? schedule.time_zone ?? "UTC" : "UTC";
}

function utcOffset(moment: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  }).formatToParts(moment);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const offset = name.replace("GMT", "");
  if (offset === "") return "+00:00";
  const [hours, minutes = "00"] = offset.slice(1).split(":");
  return `${offset[0]}${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

/** `<Ddd> <D> <Mmm> <YYYY>, <HH:mm> <zone> (UTC±HH:MM)`, or "—" for no next run. */
export function nextRunText(nextRunAt: string | null, schedule: Schedule): string {
  if (!nextRunAt) return "—";
  const zone = scheduleZone(schedule);
  const moment = new Date(nextRunAt);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(moment);
  const piece = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const stamp = `${piece("weekday")} ${piece("day")} ${piece("month")} ${piece("year")}, ${piece("hour")}:${piece("minute")}`;
  return `${stamp} ${zone} (UTC${utcOffset(moment, zone)})`;
}

export function scheduleText(schedule: Schedule): string {
  if (schedule.type === "manual") return "Manual";
  if (schedule.type === "interval") return `Every ${schedule.interval_minutes} minutes`;
  return `Cron ${schedule.cron_expression} (${schedule.time_zone})`;
}

export function localTime(stamp: string | null): string {
  if (!stamp) return "";
  return new Date(stamp).toLocaleString();
}

export function statusWord(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export const SYNC_MODE_LABELS: Record<string, string> = {
  full_refresh_overwrite: "Full refresh overwrite",
  full_refresh_append: "Full refresh append",
  incremental_append: "Incremental append",
  incremental_dedup: "Incremental dedup",
};

export function figureText(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
