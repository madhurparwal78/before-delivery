// The one workspace-local date and time format: "Mon 2 Nov, 06:30 CST", in the workspace's
// business time zone (brief: Feedback states, placeholders). Used by the server for emails and
// by the browser for every time on screen.

const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatWhen(zone: string, instant: Date | string | number): string {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    });
    formatters.set(zone, formatter);
  }
  const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} ${p.timeZoneName}`;
}

// "Wed 28 Oct" for a business date.
export function formatBusinessDate(zone: string, instant: Date): string {
  return formatWhen(zone, instant).split(",")[0] ?? "";
}
