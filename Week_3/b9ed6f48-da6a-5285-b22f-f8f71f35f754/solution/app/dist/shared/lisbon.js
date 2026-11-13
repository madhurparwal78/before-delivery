// Europe/Lisbon wall-clock rules (brief: Business rules › Time). Every conversion between an
// instant and a Lisbon wall time goes through this module, on the server and in the browser,
// so neither ever depends on the device's zone.
const MINUTE = 60_000;
const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function lastSunday(year, monthIndex) {
    const last = new Date(Date.UTC(year, monthIndex + 1, 0));
    return last.getUTCDate() - last.getUTCDay();
}
/** Summer time runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October. */
function lisbonOffsetMinutes(instant) {
    const year = new Date(instant).getUTCFullYear();
    const start = Date.UTC(year, 2, lastSunday(year, 2), 1);
    const end = Date.UTC(year, 9, lastSunday(year, 9), 1);
    return instant >= start && instant < end ? 60 : 0;
}
function lisbonWallClock(instant) {
    const shifted = new Date(instant + lisbonOffsetMinutes(instant) * MINUTE);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds(),
    };
}
function validWall(wall) {
    const probe = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second));
    return (probe.getUTCFullYear() === wall.year &&
        probe.getUTCMonth() === wall.month - 1 &&
        probe.getUTCDate() === wall.day &&
        probe.getUTCHours() === wall.hour &&
        probe.getUTCMinutes() === wall.minute &&
        probe.getUTCSeconds() === wall.second);
}
/**
 * The instant a Lisbon wall time names: the offset in force at that wall time on that date;
 * a repeated hour means its first occurrence (+01:00); a skipped hour gives "skipped".
 */
export function wallClockToInstant(wall) {
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    for (const offset of [60, 0]) {
        const instant = asUtc - offset * MINUTE;
        if (lisbonOffsetMinutes(instant) === offset)
            return instant;
    }
    return "skipped";
}
const pad = (n, width = 2) => String(n).padStart(width, "0");
function offsetText(minutes) {
    return `+${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
/** ISO 8601 with seconds and the Lisbon offset in force at that instant. */
export function toLisbonIso(instant) {
    const w = lisbonWallClock(instant);
    return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${offsetText(lisbonOffsetMinutes(instant))}`;
}
/** The `<datetime>` placeholder: `Sat 14 Nov 2026, 18:30 Lisbon time`. */
export function formatLisbonDateTime(instant) {
    const w = lisbonWallClock(instant);
    const weekday = WEEKDAYS[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()];
    return `${weekday} ${w.day} ${MONTHS[w.month - 1]} ${w.year}, ${pad(w.hour)}:${pad(w.minute)} Lisbon time`;
}
/** The `<date>` placeholder from a `YYYY-MM-DD` Lisbon date: `30 Nov 2026`. */
export function formatLisbonDate(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return `${day} ${MONTHS[month - 1]} ${year}`;
}
/** The Lisbon calendar date of an instant, as `YYYY-MM-DD`. */
export function lisbonDate(instant) {
    const w = lisbonWallClock(instant);
    return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}
const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
/** Parses ISO 8601 with seconds and an explicit offset; anything else is null. */
export function parseIsoWithOffset(text) {
    const m = ISO_WITH_OFFSET.exec(text);
    if (!m)
        return null;
    const wall = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +m[6] };
    if (!validWall(wall))
        return null;
    const zone = m[8];
    const offset = zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
    if (Math.abs(offset) > 14 * 60)
        return null;
    return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - offset * MINUTE;
}
const WALL_ENTRY = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;
/** A `YYYY-MM-DD HH:MM[:SS]` entry, or null when it does not fit the format. */
export function parseWallClockEntry(text) {
    const m = WALL_ENTRY.exec(text.trim());
    if (!m)
        return null;
    const wall = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: m[6] ? +m[6] : 0 };
    return validWall(wall) ? wall : null;
}
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A `YYYY-MM-DD` date, normalised, or null. */
export function parseDateEntry(text) {
    const m = DATE_ONLY.exec(text.trim());
    if (!m)
        return null;
    const wall = { year: +m[1], month: +m[2], day: +m[3], hour: 0, minute: 0, second: 0 };
    return validWall(wall) ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** 00:00 Lisbon time on a `YYYY-MM-DD` date. Midnight is never inside a skipped hour. */
export function lisbonMidnight(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return wallClockToInstant({ year, month, day, hour: 0, minute: 0, second: 0 });
}
/** [start, end) instants of a `YYYY-MM` month in Lisbon time. */
export function lisbonMonthRange(month) {
    const [year, monthNumber] = month.split("-").map(Number);
    const next = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${pad(monthNumber + 1)}-01`;
    return [lisbonMidnight(`${month}-01`), lisbonMidnight(next)];
}
/** The date `days` after a `YYYY-MM-DD` date. */
export function addDays(isoDate, days) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day) + days * DAY).toISOString().slice(0, 10);
}
