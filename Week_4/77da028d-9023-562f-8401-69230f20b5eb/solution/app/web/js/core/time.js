// Wall-clock conversion in the site's time zone (display and input only; the server decides dates and minutes).
const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }));
  }
  return formatters.get(timeZone);
}

function wallParts(epochMs, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(epochMs)).map((part) => [part.type, part.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute };
}

function offsetMinutes(epochMs, timeZone) {
  const wall = wallParts(epochMs, timeZone);
  return (Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - Math.floor(epochMs / 60000) * 60000) / 60000;
}

// "HH:MM" on the site's wall clock, `minute` minutes after the ISO instant `dusk`.
export function siteTimeAt(dusk, minute, timeZone) {
  const wall = wallParts(Date.parse(dusk) + minute * 60000, timeZone);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

function isoOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

// "YYYY-MM-DD HH:MM" in the site's zone -> ISO 8601 with offset. A repeated hour takes the earlier instant;
// a skipped hour moves forward by the gap. Returns null when the text is not a date and time.
export function wallToIso(text, timeZone) {
  const match = WALL.exec(text.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const guesses = new Set([offsetMinutes(wallMs - 86400000, timeZone), offsetMinutes(wallMs + 86400000, timeZone)]);
  const valid = [...guesses].filter((offset) => offsetMinutes(wallMs - offset * 60000, timeZone) === offset);
  const offset = valid.length ? valid.reduce((earliest, next) => (next > earliest ? next : earliest))
    : Math.min(...guesses);
  const pad = (value) => String(value).padStart(2, '0');
  const instant = wallMs - offset * 60000;
  const shifted = valid.length ? { year, month, day, hour, minute } : wallParts(instant, timeZone);
  return `${shifted.year}-${pad(shifted.month)}-${pad(shifted.day)}T${pad(shifted.hour)}:${pad(shifted.minute)}:00${isoOffset(valid.length ? offset : offsetMinutes(instant, timeZone))}`;
}

// The ISO instant as "YYYY-MM-DD HH:MM" on the site's wall clock.
export function isoToWall(iso, timeZone) {
  const wall = wallParts(Date.parse(iso), timeZone);
  const pad = (value) => String(value).padStart(2, '0');
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}`;
}
