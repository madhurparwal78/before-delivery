import { businessDate, cancellationCutoff, formatInstant, formatWallClock, wallClockInstant } from "./practiceTime.js";
let practice = { name: "", time_zone: "UTC" };
export async function loadPractice(db) {
    const { rows } = await db.query(`SELECT name, time_zone FROM practice WHERE id = 1`);
    practice = rows[0] ?? practice;
}
export const practiceInfo = () => practice;
export const zone = () => practice.time_zone;
export const today = (at) => businessDate(at, practice.time_zone);
export const stamp = (instant) => formatInstant(typeof instant === "number" ? instant : instant.getTime(), practice.time_zone);
export const stampOrNull = (instant) => (instant ? stamp(instant) : null);
/** `YYYY-MM-DD HH:MM (<time zone>)`, the cutoff and link-expiry copy format. */
export const wallClock = (instant) => formatWallClock(typeof instant === "number" ? instant : instant.getTime(), practice.time_zone);
/** `HH:MM:SS` of an instant in the practice zone. */
export const clockSeconds = (instant) => stamp(instant).slice(11, 19);
export const businessDateOf = (instant) => businessDate(typeof instant === "number" ? instant : instant.getTime(), practice.time_zone);
/** Start instant of a barn day; stored days always resolve because their start was validated on save. */
export function startsAt(date, time) {
    const instant = wallClockInstant(date, time, practice.time_zone);
    if (instant === null)
        throw new Error(`Stored barn day start ${date} ${time} does not exist`);
    return instant;
}
export const cutoffAt = (date, time) => cancellationCutoff(startsAt(date, time));
