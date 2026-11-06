import { config } from './config.js';
export function now() {
    return new Date(Date.now() + config.clockOffsetSeconds * 1000);
}
let practiceZone = 'America/Denver';
export function setPracticeZone(zone) {
    practiceZone = zone;
}
export function practiceZoneName() {
    return practiceZone;
}
function fmtOffset(offsetSeconds) {
    const sign = offsetSeconds < 0 ? '-' : '+';
    const a = Math.abs(offsetSeconds);
    const h = String(Math.floor(a / 3600)).padStart(2, '0');
    const m = String(Math.floor((a % 3600) / 60)).padStart(2, '0');
    return `${sign}${h}:${m}`;
}
export function offsetAt(zone, instant) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = dtf.formatToParts(instant);
    const map = {};
    for (const p of parts)
        map[p.type] = p.value;
    const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour === '24' ? '0' : map.hour), Number(map.minute), Number(map.second));
    return Math.round((asUTC - instant.getTime()) / 1000);
}
export function zonedParts(zone, instant) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = dtf.formatToParts(instant);
    const map = {};
    for (const p of parts)
        map[p.type] = p.value;
    return {
        year: Number(map.year), month: Number(map.month), day: Number(map.day),
        hour: Number(map.hour === '24' ? 0 : Number(map.hour)), minute: Number(map.minute), second: Number(map.second)
    };
}
export function businessDate(zone, instant) {
    const p = zonedParts(zone, instant);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
export function todayInPractice() {
    return businessDate(practiceZone, now());
}
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
export function resolveWallClock(date, time, zone) {
    if (!DATE_RE.test(date) || !TIME_RE.test(time))
        return null;
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const utcGuess = Date.UTC(y, m - 1, d, hh, mm);
    const off1 = offsetAt(zone, new Date(utcGuess - 24 * 3600 * 1000));
    const off2 = offsetAt(zone, new Date(utcGuess + 24 * 3600 * 1000));
    for (const off of [off1, off2]) {
        const t = new Date(utcGuess - off * 1000);
        const parts = zonedParts(zone, t);
        if (parts.year === y && parts.month === m && parts.day === d && parts.hour === hh && parts.minute === mm) {
            return t;
        }
    }
    return null;
}
export function printInstant(t) {
    const off = offsetAt(practiceZone, t);
    const p = zonedParts(practiceZone, t);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T` +
        `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}` +
        `${fmtOffset(off)}`;
}
export function printCutoff(t) {
    const p = zonedParts(practiceZone, t);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ` +
        `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} (${practiceZone})`;
}
export function printTime(t) {
    const p = zonedParts(practiceZone, t);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
export function printTimeSec(t) {
    const p = zonedParts(practiceZone, t);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
}
export function printDateTimeZone(t) {
    const p = zonedParts(practiceZone, t);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ` +
        `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} (${practiceZone})`;
}
export function validDate(s) {
    return typeof s === 'string' && DATE_RE.test(s);
}
export function validTime(s) {
    return typeof s === 'string' && TIME_RE.test(s);
}
export function addDays(date, days) {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
export function dateDiffDays(a, b) {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
export function monthOf(date) {
    return date.slice(0, 7);
}
