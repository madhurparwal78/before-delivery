// Time and number formatting. "Local time" is YYYY-MM-DD HH:MM ZZZ in a stated zone, never the browser's.
import { ZONE_ABBR } from './zoneabbr.js';

const formatters = new Map();

function parts(ms, zone) {
  let fmt = formatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    formatters.set(zone, fmt);
  }
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

// offsetMinutes is the zone's UTC offset at an instant.
export function offsetMinutes(ms, zone) {
  const p = parts(ms, zone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

// zoneAbbr is the tz database abbreviation (CDT, IST, CET ...) of a zone at an instant.
function zoneAbbr(ms, zone) {
  const offset = offsetMinutes(ms, zone);
  const known = ZONE_ABBR[zone];
  if (known && known[offset]) return known[offset];
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${abs % 60 ? String(abs % 60).padStart(2, '0') : ''}`;
}

// localDate is YYYY-MM-DD in a zone; localHM is HH:MM in a zone.
export function localDate(iso, zone) {
  const p = parts(Date.parse(iso), zone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localHM(iso, zone) {
  const p = parts(Date.parse(iso), zone);
  return `${p.hour}:${p.minute}`;
}

// fmtLocal is "YYYY-MM-DD HH:MM ZZZ".
export function fmtLocal(iso, zone) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  const p = parts(ms, zone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${zoneAbbr(ms, zone)}`;
}

// Countdown text: MM:SS, or H:MM:SS from one hour; "--:--" for no timer.
export function fmtCountdown(seconds) {
  if (seconds === null || seconds === undefined) return '--:--';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

// instantFromLocal reads "YYYY-MM-DD HH:MM" typed in a zone and returns the UTC instant (ISO, whole seconds) or null.
// A local time that does not exist takes the first valid instant after the jump; a repeated one takes its first occurrence.
export function instantFromLocal(text, zone) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const day = 24 * 3600 * 1000;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = [...new Set([offsetMinutes(wall - day, zone), offsetMinutes(wall + day, zone)])];
  const valid = offsets.map((o) => wall - o * 60000).filter((ms, i) => offsetMinutes(ms, zone) === offsets[i]);
  let ms;
  if (valid.length) {
    ms = Math.min(...valid);
  } else {
    // The wall time falls in a gap: take the moment the offset changes.
    let lo = wall - day;
    let hi = wall + day;
    const before = offsetMinutes(lo, zone);
    while (hi - lo > 1000) {
      const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
      if (offsetMinutes(mid, zone) === before) lo = mid;
      else hi = mid;
    }
    ms = hi;
  }
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
