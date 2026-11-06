"use strict";
// The single place where club-local wall-clock time and UTC instants meet.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wallTimeOf = wallTimeOf;
exports.localToInstant = localToInstant;
exports.instantToUtcSeconds = instantToUtcSeconds;
exports.instantToIso = instantToIso;
exports.isoToInstantSeconds = isoToInstantSeconds;
exports.cutoffDisplay = cutoffDisplay;
exports.pickupDisplay = pickupDisplay;
exports.calendarDate = calendarDate;
exports.wallClockText = wallClockText;
exports.wallClockToInstant = wallClockToInstant;
const partCache = new Map();
function dtf(timeZone) {
    let f = partCache.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        partCache.set(timeZone, f);
    }
    return f;
}
function wallTimeOf(instantMs, timeZone) {
    const parts = dtf(timeZone).formatToParts(instantMs);
    const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
    return {
        year: get("year"),
        month: get("month"),
        day: get("day"),
        hour: get("hour"),
        minute: get("minute"),
        second: get("second"),
    };
}
/** Offset of the zone at an instant, in seconds east of UTC. */
function zoneOffset(instantMs, timeZone) {
    const w = wallTimeOf(instantMs, timeZone);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    return (asUtc - instantMs) / 1000;
}
const localRe = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
/** Reads a club-local wall-clock time. Repeated times take their earlier instant. */
function localToInstant(local, timeZone) {
    const m = localRe.exec(local.trim());
    if (!m)
        return { kind: "bad" };
    const [, ys, mos, ds, hs, mis, ss] = m;
    const year = parseInt(ys, 10);
    const month = parseInt(mos, 10);
    const day = parseInt(ds, 10);
    const hour = parseInt(hs, 10);
    const minute = parseInt(mis, 10);
    const second = ss === undefined ? 0 : parseInt(ss, 10);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
        return { kind: "bad" };
    }
    const naive = Date.UTC(year, month - 1, day, hour, minute, second);
    if (Number.isNaN(naive))
        return { kind: "bad" };
    const off1 = zoneOffset(naive, timeZone);
    const instant1 = naive - off1 * 1000;
    const wall1 = wallTimeOf(instant1, timeZone);
    const off2 = zoneOffset(instant1, timeZone);
    const instant2 = naive - off2 * 1000;
    const wall2 = wallTimeOf(instant2, timeZone);
    const matches = (w) => w.year === year && w.month === month && w.day === day && w.hour === hour && w.minute === minute && w.second === second;
    const valid1 = matches(wall1);
    const valid2 = matches(wall2);
    if (valid1 && valid2)
        return { kind: "instant", instantMs: Math.min(instant1, instant2) };
    if (valid1)
        return { kind: "instant", instantMs: instant1 };
    if (valid2)
        return { kind: "instant", instantMs: instant2 };
    return { kind: "gap" };
}
function instantToUtcSeconds(instantMs) {
    return Math.floor(instantMs / 1000);
}
function pad(n, width = 2) {
    return String(n).padStart(width, "0");
}
/** UTC ISO 8601 with Z and whole seconds. */
function instantToIso(instantSeconds) {
    if (instantSeconds === null)
        return null;
    return new Date(instantSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function isoToInstantSeconds(iso) {
    if (iso === null)
        return null;
    return Math.floor(Date.parse(iso) / 1000);
}
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function weekdayOf(w) {
    const utc = Date.UTC(w.year, w.month - 1, w.day);
    return weekdays[new Date(utc).getUTCDay()];
}
function timeText(w) {
    const h24 = w.hour;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const ampm = h24 < 12 ? "am" : "pm";
    const base = `${h12}:${pad(w.minute)}`;
    if (w.second !== 0)
        return `${base}:${pad(w.second)} ${ampm}`;
    return `${base} ${ampm}`;
}
function zoneShort(instantSeconds, timeZone) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" });
    const parts = f.formatToParts(instantSeconds * 1000);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}
/** `<Ddd> <D> <Mon>, <time> <zone>` */
function cutoffDisplay(instantSeconds, timeZone) {
    const w = wallTimeOf(instantSeconds * 1000, timeZone);
    return `${weekdayOf(w)} ${w.day} ${months[w.month - 1]}, ${timeText(w)} ${zoneShort(instantSeconds, timeZone)}`;
}
function datePrefix(w) {
    return `${weekdayOf(w)} ${w.day} ${months[w.month - 1]}`;
}
/** `<start date>, <start time> [zone] to [<end date>,] <end time> <end zone>` */
function pickupDisplay(startSeconds, endSeconds, timeZone) {
    const ws = wallTimeOf(startSeconds * 1000, timeZone);
    const we = wallTimeOf(endSeconds * 1000, timeZone);
    const startZone = zoneShort(startSeconds, timeZone);
    const endZone = zoneShort(endSeconds, timeZone);
    const sameDate = ws.year === we.year && ws.month === we.month && ws.day === we.day;
    const zonesDiffer = startZone !== endZone;
    let out = `${datePrefix(ws)}, ${timeText(ws)}`;
    if (zonesDiffer)
        out += ` ${startZone}`;
    out += " to ";
    if (!sameDate)
        out += `${datePrefix(we)}, `;
    out += `${timeText(we)} ${endZone}`;
    return out;
}
/** Club-local calendar date, `YYYY-MM-DD`. */
function calendarDate(instantSeconds, timeZone) {
    const w = wallTimeOf(instantSeconds * 1000, timeZone);
    return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}
/** The club-local wall-clock string for editing, `YYYY-MM-DD HH:MM[:SS]`. */
function wallClockText(instantSeconds, timeZone) {
    const w = wallTimeOf(instantSeconds * 1000, timeZone);
    const base = `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
    if (w.second !== 0)
        return `${base}:${pad(w.second)}`;
    return base;
}
/** Club-local wall-clock time parsed from an edit field (`YYYY-MM-DD HH:MM[:SS]`). */
function wallClockToInstant(text, timeZone) {
    const t = text.trim().replace(" ", "T");
    return localToInstant(t, timeZone);
}
