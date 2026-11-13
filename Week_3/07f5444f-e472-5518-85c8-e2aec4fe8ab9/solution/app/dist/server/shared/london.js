// London wall-clock time: the orchestra's business zone, shared by the server and the client.
const BUSINESS_ZONE = "Europe/London";
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const londonParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
});
function wallClockAt(instant) {
    const fields = {};
    for (const part of londonParts.formatToParts(new Date(instant))) {
        if (part.type !== "literal")
            fields[part.type] = Number(part.value);
    }
    return {
        year: fields.year ?? 0,
        month: fields.month ?? 0,
        day: fields.day ?? 0,
        hour: fields.hour ?? 0,
        minute: fields.minute ?? 0,
        second: fields.second ?? 0,
    };
}
function offsetMinutesAt(instant) {
    const wall = wallClockAt(instant);
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE_MS);
}
const pad = (value, width = 2) => String(value).padStart(width, "0");
function offsetText(minutes) {
    const sign = minutes < 0 ? "-" : "+";
    const size = Math.abs(minutes);
    return `${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}
/**
 * The instant a London wall-clock time names. A time that occurs twice (the hour after the clocks
 * go back) is the earlier instant; a time that does not occur (the hour skipped in spring) is null.
 */
export function wallClockToInstant(wall) {
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    for (const offset of [60, 0]) {
        const instant = asUtc - offset * MINUTE_MS;
        if (offsetMinutesAt(instant) === offset)
            return instant;
    }
    return null;
}
/** `YYYY-MM-DDTHH:MM:SS±HH:MM` with London's offset for that instant. */
export function londonTimestamp(instant) {
    const wall = wallClockAt(instant);
    return (`${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
        offsetText(offsetMinutesAt(instant)));
}
/** The business-zone date (`YYYY-MM-DD`) of an instant. */
export function londonDate(instant) {
    const wall = wallClockAt(instant);
    return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}
export function addDays(isoDate, days) {
    const [year, month, day] = isoDate.split("-").map(Number);
    const moved = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) + days * DAY_MS);
    return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}
function dateLabelOf(year, month, day) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]} ${year}`;
}
/** `Sat 14 Nov 2026` for a business-zone date. */
export function dateLabel(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return dateLabelOf(year ?? 0, month ?? 1, day ?? 1);
}
/** `Tue 1 Dec 2026, 10:00` in London time for a timestamp. */
export function dateTimeLabel(timestamp) {
    const wall = wallClockAt(Date.parse(timestamp));
    return `${dateLabelOf(wall.year, wall.month, wall.day)}, ${pad(wall.hour)}:${pad(wall.minute)}`;
}
const WALL_CLOCK_FORM = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
/** Reads a typed `YYYY-MM-DD HH:MM` London time into a timestamp with London's offset for it. */
export function readWallClock(text) {
    const match = WALL_CLOCK_FORM.exec(text.replace(/^ +| +$/g, ""));
    if (!match)
        return { kind: "malformed" };
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59) {
        return { kind: "malformed" };
    }
    const instant = wallClockToInstant({ year, month, day, hour, minute });
    if (instant === null)
        return { kind: "missing", time: `${pad(hour)}:${pad(minute)}`, date: dateLabelOf(year, month, day) };
    const offset = offsetMinutesAt(instant);
    return {
        kind: "timestamp",
        timestamp: `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${offsetText(offset)}`,
    };
}
