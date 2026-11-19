// Federal Reserve business days and New York local time. All instants are
// epoch milliseconds; dates are plain objects with y, m, d (UTC-rendered).

// 00:00 America/New_York local time for the given local date, resolved by that
// date's own daylight-saving rule (Eastern Time has moved only in 2007+).
export function nyMidnightUtcMs(yIn, mIn, dIn) {
  // Normalize day overflow (e.g. d=32) into a real calendar date first.
  const t0 = new Date(Date.UTC(yIn, mIn - 1, dIn));
  const y = t0.getUTCFullYear(), m = t0.getUTCMonth() + 1, d = t0.getUTCDate();
  // Eastern local midnight is 04:00Z or 05:00Z. Probe each candidate and keep
  // the one that maps back to 00:00 local time.
  for (const offHours of [4, 5]) {
    const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + offHours * 3600 * 1000;
    const ny = nyParts(guess);
    if (ny.y === y && ny.m === m && ny.d === d && ny.hh === 0 && ny.mm === 0) return guess;
  }
  return null;
}

export function zonedParts(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
  });
  const out = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  const hour = out.hour === '24' ? 0 : Number(out.hour);
  return {
    y: Number(out.year), m: Number(out.month), d: Number(out.day),
    hh: hour, mm: Number(out.minute), ss: Number(out.second),
    ms: Number(out.fractionalSecond),
  };
}

export function nyParts(utcMs) {
  return zonedParts(utcMs, 'America/New_York');
}

export function nyDateStr(utcMs) {
  const p = nyParts(utcMs);
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function nyEndOfDayMs(y, m, d) {
  const midnight = nyMidnightUtcMs(y, m, d);
  if (midnight === null) return null;
  return midnight - 1; // 23:59:59.999 local on that date
}

export function endOfDayNy(utcMs) {
  // 23:59:59.999 New York on the New York date of utcMs.
  const p = nyParts(utcMs);
  const nextMidnight = nyMidnightUtcMs(p.y, p.m, p.d + 1);
  if (nextMidnight === null) {
    // month rollover handled by Date.UTC normalisation inside nyMidnightUtcMs
    return null;
  }
  return nextMidnight - 1;
}

export function dateFromStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function dateStr(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---- Federal Reserve holidays (observed rules for moveable and weekend ones)

function nthWeekday(y, m, weekday, n) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const offset = (weekday - first + 7) % 7 + (n - 1) * 7 + 1;
  return offset;
}

function lastWeekday(y, m, weekday) {
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  const offset = lastDay - ((lastDow - weekday + 7) % 7);
  return offset;
}

function thanksgiving(y) {
  const firstDow = new Date(Date.UTC(y, 10, 1)).getUTCDay();
  return ((4 - firstDow + 7) % 7) + 1 + 21;
}

// Returns the set of observed Federal Reserve holiday dates for the year.
export function fedHolidays(y) {
  const h = new Set();
  const fixed = [
    [1, 1], [6, 19], [7, 4], [11, 11], [12, 25],
  ];
  const add = (m, d) => h.add(dateStr(y, m, d));
  for (const [m, d] of fixed) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 0) add(m, d + 1); // Sunday observed Monday
    else if (dow !== 6) add(m, d); // Saturday not observed
  }
  add(1, nthWeekday(y, 1, 1, 3));      // MLK third Monday
  add(2, nthWeekday(y, 2, 1, 3));     // Washington's Birthday
  add(5, lastWeekday(y, 5, 1));       // Memorial Day
  add(9, nthWeekday(y, 9, 1, 1));     // Labor Day
  add(10, nthWeekday(y, 10, 1, 2));   // Columbus Day
  add(11, thanksgiving(y));           // Thanksgiving
  return h;
}

export function isBusinessDay(dateStr_) {
  const { y, m, d } = dateFromStr(dateStr_);
  if (y === undefined) return false;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !fedHolidays(y).has(dateStr_);
}

export function nextBusinessDay(dateStr_) {
  let { y, m, d } = dateFromStr(dateStr_);
  for (let i = 0; i < 400; i++) {
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
    const s = dateStr(y, m, d);
    if (isBusinessDay(s)) return s;
  }
  return null;
}

export function firstBusinessDayOnOrAfter(dateStr_) {
  if (isBusinessDay(dateStr_)) return dateStr_;
  return nextBusinessDay(dateStr_);
}

// The Nth Federal Reserve business day strictly after the given date.
export function nthBusinessDayAfter(dateStr_, n) {
  let s = dateStr_;
  let count = 0;
  for (let i = 0; i < 800 && count < n; i++) {
    s = nextBusinessDay(s);
    if (s === null) return null;
    count++;
  }
  return s;
}

export function addCalendarDays(dateStr_, n) {
  const { y, m, d } = dateFromStr(dateStr_);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return dateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
