// Job-local times for display, from UTC instants or job-local ISO strings.

/** `YYYY-MM-DD HH:MM` in the job's time zone. */
export function localDateTime(isoUtc: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(isoUtc))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** `HH:MM` in the job's time zone. */
export function localClock(isoUtc: string, timeZone: string): string {
  return localDateTime(isoUtc, timeZone).slice(11);
}

/** A job-local `YYYY-MM-DDTHH:MM:SS` shown as `YYYY-MM-DD HH:MM`. */
export function localStamp(local: string): string {
  return local.replace("T", " ").slice(0, 16);
}
