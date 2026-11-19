export const SYNC_MODES = [
  ["full_refresh_overwrite", "Full refresh overwrite"],
  ["full_refresh_append", "Full refresh append"],
  ["incremental_append", "Incremental append"],
  ["incremental_dedup", "Incremental dedup"],
];
export const modeLabel = (mode) => Object.fromEntries(SYNC_MODES)[mode] ?? mode;

// The next-run text: "<Ddd> <D> <Mmm> <YYYY>, <HH:mm> <zone> (UTC<±HH:MM>)", the wall clock of the connection's
// own zone (UTC for interval schedules), never the browser's.
function nextRunText(iso, zone) {
  if (!iso) return "—";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  const offset = parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.replace("GMT", "");
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${zone} (UTC${offset})`;
}

export function local(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso));
}

// A date with its hour and minute, for lists where the second adds nothing.
export function localMinute(iso) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

// A log line's time of day; one run spans seconds, so the date adds nothing.
export function clock(iso) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

export function scheduleText(schedule) {
  if (schedule.type === "manual") return "Manual";
  if (schedule.type === "interval") return `Every ${schedule.interval_minutes} minutes`;
  return `Cron ${schedule.cron_expression} (${schedule.time_zone})`;
}

export function nextRun(connection) {
  return nextRunText(connection.next_run_at, connection.schedule.type === "cron" ? connection.schedule.time_zone : "UTC");
}

export function seconds(value) {
  if (value === null || value === undefined) return "—";
  if (value < 90) return `${value.toFixed(1)} s`;
  if (value < 5400) return `${Math.round(value / 60)} min`;
  return `${(value / 3600).toFixed(1)} h`;
}
