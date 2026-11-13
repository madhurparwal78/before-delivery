// League time is Europe/Dublin (brief: Deadline and lock), written as "Sat 8 Nov 13:30".
const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function leagueTime(instant: Date): string {
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.formatToParts(instant).find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("hour")}:${get("minute")}`;
}
