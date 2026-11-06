// Lender preview transitions and publish time (brief: Business rules, Lender preview, Publish time).
export type PreviewStatus = "draft" | "scheduled" | "published" | "withdrawn";
type PreviewAction = "schedule" | "cancel" | "publish" | "withdraw";

const TRANSITIONS: Record<PreviewAction, PreviewStatus[]> = {
  schedule: ["draft", "withdrawn"],
  cancel: ["scheduled"],
  publish: ["scheduled"],
  withdraw: ["published"],
};
const RESULT: Record<PreviewAction, PreviewStatus> = {
  schedule: "scheduled",
  cancel: "draft",
  publish: "published",
  withdraw: "withdrawn",
};

export function previewNext(action: PreviewAction, current: PreviewStatus): PreviewStatus | null {
  return TRANSITIONS[action].includes(current) ? RESULT[action] : null;
}

/** The statuses an action may start from, for queries that pick rows ready for it. */
export function previewSources(action: PreviewAction): PreviewStatus[] {
  return TRANSITIONS[action];
}

/** Scheduling after withdrawal starts a new preview with a new id and new links. */
export function startsNewPreview(current: PreviewStatus): boolean {
  return current === "withdrawn";
}

const MIN_LEAD_MS = 2 * 60 * 60 * 1000;
const PUBLISH_HOUR = 9;

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant of hh:00 on a calendar date in a time zone. */
function zonedInstant(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  let instant = guess - zoneOffsetMs(guess, timeZone);
  instant = guess - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

type DateCheck = { ok: true; publishAt: Date } | { ok: false; field: "badly_formed" | "too_soon" };

/**
 * The publish time for a chosen date: 09:00 museum time, at least 2 hours away; or, when a publish
 * delay is configured, the scheduling time plus that delay with no 2-hour check.
 */
export function publishTime(date: unknown, now: Date, timeZone: string, delaySeconds: number | null): DateCheck {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, field: "badly_formed" };
  const [y, m, d] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return { ok: false, field: "badly_formed" };
  }
  if (delaySeconds !== null) return { ok: true, publishAt: new Date(now.getTime() + delaySeconds * 1000) };
  const publishAt = zonedInstant(date, PUBLISH_HOUR, timeZone);
  if (publishAt.getTime() - now.getTime() < MIN_LEAD_MS) return { ok: false, field: "too_soon" };
  return { ok: true, publishAt };
}

/** `Tuesday 2 March 2027, 09:00 museum time`, in the museum's time zone. */
export function museumDisplay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} museum time`;
}
