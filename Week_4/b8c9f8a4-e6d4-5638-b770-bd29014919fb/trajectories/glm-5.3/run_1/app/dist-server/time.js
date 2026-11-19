/** Time helpers. London zone is the product's display zone; the server stores UTC. */
export function londonOffsetMinutes(date) {
    // Europe/London: GMT (0) in winter, BST (+60) from the last Sunday of March 01:00 UTC
    // to the last Sunday of October 01:00 UTC.
    const year = date.getUTCFullYear();
    const lastMarchSunday = lastSunday(year, 2, 31);
    const lastOctoberSunday = lastSunday(year, 9, 31);
    const t = date.getTime();
    if (t >= Date.UTC(year, 2, lastMarchSunday, 1) && t < Date.UTC(year, 9, lastOctoberSunday, 1))
        return 60;
    return 0;
}
function lastSunday(year, month0, lastDay) {
    const d = new Date(Date.UTC(year, month0, lastDay));
    return d.getUTCDate() - d.getUTCDay();
}
export function zoneName(date) {
    return londonOffsetMinutes(date) === 60 ? 'BST' : 'GMT';
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function londonParts(date) {
    const shifted = new Date(date.getTime() + londonOffsetMinutes(date) * 60_000);
    return {
        year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate(),
        weekday: shifted.getUTCDay(), hours: shifted.getUTCHours(), minutes: shifted.getUTCMinutes(),
    };
}
/** `14 Nov 2026, 10:30` in London. */
export function formatLondonDateTime(date) {
    const p = londonParts(date);
    return `${p.day} ${MONTHS[p.month]} ${p.year}, ${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
}
/** Slot label: `Sat 14 Nov 2026, 10:30 GMT`. */
export function slotLabel(date) {
    const p = londonParts(date);
    return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month]} ${p.year}, ${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')} ${zoneName(date)}`;
}
/** `<hours>h <minutes>m <seconds>s left`, whole hours uncapped. */
export function formatTimeLeft(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s left`;
}
/**
 * Resolve a local London wall time `YYYY-MM-DDTHH:mm` to UTC instants.
 * Returns [] when the time does not exist in London on that date (spring forward gap),
 * and two instants when it occurs twice (autumn overlap).
 */
export function londonInstants(localStart) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localStart);
    if (!m)
        return [];
    const [, y, mo, d, h, mi] = m;
    const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
    const candidates = [naive - 60 * 60_000, naive, naive + 60 * 60_000];
    const hits = [];
    for (const c of candidates) {
        const shifted = new Date(c + londonOffsetMinutes(new Date(c)) * 60_000);
        if (shifted.getUTCHours() === Number(h) && shifted.getUTCMinutes() === Number(mi)
            && shifted.getUTCDate() === Number(d) && shifted.getUTCMonth() === Number(mo) - 1) {
            hits.push(new Date(c));
        }
    }
    return hits;
}
