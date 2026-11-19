/**
 * Date and time formatting for people. This module is the single place that
 * writes instants as "<D> <Month> <YYYY>, <HH:MM>", calendar dates as
 * "<D> <Month> <YYYY>" and month labels as "<Month YYYY>" in a chosen IANA
 * time zone, using that zone's real offset at the instant (DP-51, DP-59).
 *
 * The browser has Intl; Node has full ICU. Both sides share these functions so
 * every date a person sees is written the same way.
 */
const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
export function zonedParts(instant, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
    const parts = formatter.formatToParts(instant);
    const get = (type) => {
        const part = parts.find((p) => p.type === type);
        return part ? part.value : "";
    };
    let hour = Number.parseInt(get("hour"), 10);
    if (hour === 24)
        hour = 0;
    return {
        year: Number.parseInt(get("year"), 10),
        month: Number.parseInt(get("month"), 10),
        day: Number.parseInt(get("day"), 10),
        hour,
        minute: Number.parseInt(get("minute"), 10),
    };
}
/** "<D> <Month> <YYYY>, <HH:MM>", for example "9 November 2026, 14:05". */
export function formatInstant(instant, timeZone) {
    const p = zonedParts(instant, timeZone);
    return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${p.hour.toString().padStart(2, "0")}:${p.minute
        .toString()
        .padStart(2, "0")}`;
}
/** "<D> <Month> <YYYY>", for example "9 November 2026". */
export function formatCalendarDate(instant, timeZone) {
    const p = zonedParts(instant, timeZone);
    return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}
/** The operator's local calendar date for billing, as YYYY-MM-DD (DP-59). */
export function localCalendarDate(instant, timeZone) {
    const p = zonedParts(instant, timeZone);
    return `${p.year}-${p.month.toString().padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}
/** "<Month YYYY>", for example "March 2027". */
export function monthLabel(month, timeZone) {
    const [year, monthNumber] = month.split("-").map((piece) => Number.parseInt(piece, 10));
    // The month label never depends on the zone's offset, but the signature keeps
    // call sites honest: a month is a calendar month in the operator's zone.
    void timeZone;
    return `${MONTHS[monthNumber - 1]} ${year}`;
}
/** The calendar month (YYYY-MM) an instant falls in, in a time zone. */
export function currentMonth(instant, timeZone) {
    const p = zonedParts(instant, timeZone);
    return `${p.year}-${p.month.toString().padStart(2, "0")}`;
}
/** The month a given number of months after a YYYY-MM month. */
export function addMonths(month, count) {
    const [year, monthNumber] = month.split("-").map((piece) => Number.parseInt(piece, 10));
    const zero = (year - 1970) * 12 + (monthNumber - 1) + count;
    const newYear = 1970 + Math.floor(zero / 12);
    const newMonth = (zero % 12) + 1;
    return `${newYear}-${newMonth.toString().padStart(2, "0")}`;
}
export function isMonthString(text) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
}
