/**
 * All server times are stored as epoch milliseconds and exposed as ISO 8601 strings
 * carrying the Europe/Brussels offset that applies at that instant.
 */
export function isoInBrussels(epochMs) {
    const d = new Date(epochMs);
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Brussels',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(d);
    const get = (t) => parts.find(p => p.type === t)?.value ?? '';
    let hour = get('hour');
    if (hour === '24')
        hour = '00';
    const offset = brusselsOffsetEpochMs(epochMs);
    const sign = offset < 0 ? '-' : '+';
    const abs = Math.abs(offset);
    const oh = String(Math.floor(abs / 3_600_000)).padStart(2, '0');
    const om = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, '0');
    return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}${sign}${oh}:${om}`;
}
export function brusselsOffsetEpochMs(epochMs) {
    const d = new Date(epochMs);
    const dtf = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Brussels',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    const parts = dtf.formatToParts(d);
    const get = (t) => Number(parts.find(p => p.type === t)?.value ?? '0');
    let hour = get('hour');
    if (hour === 24)
        hour = 0;
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return asUtc - Math.floor(epochMs / 1000) * 1000;
}
/** Brussels wall-clock calendar parts for an instant. */
export function brusselsParts(epochMs) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Brussels',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(new Date(epochMs));
    const get = (t) => Number(parts.find(p => p.type === t)?.value ?? '0');
    const wdText = parts.find(p => p.type === 'weekday')?.value ?? 'Mon';
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wdText.slice(0, 3));
    let hh = get('hour');
    if (hh === 24)
        hh = 0;
    return { y: get('year'), m: get('month'), d: get('day'), hh, mm: get('minute'), weekday: wd < 0 ? 0 : wd };
}
/** ISO calendar date in Brussels for an instant, e.g. 2026-11-13. */
export function brusselsDate(epochMs) {
    const p = brusselsParts(epochMs);
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
/** Brussels calendar month, e.g. 2026-11. */
export function brusselsMonth(epochMs) {
    const p = brusselsParts(epochMs);
    return `${p.y}-${String(p.m).padStart(2, '0')}`;
}
export function brusselsHHMM(epochMs) {
    const p = brusselsParts(epochMs);
    return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}
/** Parses "YYYY-MM-DDTHH:MM[:SS]" or "YYYY-MM-DD HH:MM[:SS]" in Brussels into epoch ms. */
export function parseBrusselsLocal(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (!m)
        return null;
    return localToEpoch(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}
/** Finds the epoch ms for Brussels wall-clock fields, using the actual DST rules of that date. */
export function localToEpoch(y, mo, d, hh, mm) {
    const naive = Date.UTC(y, mo - 1, d, hh, mm, 0, 0);
    let offset = brusselsOffsetEpochMs(naive);
    if (!isValidBrussels(naive, offset, y, mo, d, hh, mm)) {
        offset = brusselsOffsetEpochMs(naive + offset);
    }
    return naive - offset;
}
function isValidBrussels(naive, offset, y, mo, d, hh, mm) {
    const shifted = naive - offset;
    const p = brusselsParts(shifted);
    return p.y === y && p.m === mo && p.d === d && p.hh === hh && p.mm === mm;
}
/** Inclusive range [start of day, start of next day) for the Brussels calendar date, in epoch ms. */
export function brusselsDayRange(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m)
        return null;
    const start = localToEpoch(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0);
    const p = brusselsParts(start);
    const next = localToEpoch(p.y, p.m, p.d + 1, 0, 0);
    return { start, end: next };
}
/** Inclusive range of a Brussels calendar month. */
export function brusselsMonthRange(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m)
        return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const start = localToEpoch(y, mo, 1, 0, 0);
    const end = localToEpoch(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1, 0, 0);
    return { start, end };
}
