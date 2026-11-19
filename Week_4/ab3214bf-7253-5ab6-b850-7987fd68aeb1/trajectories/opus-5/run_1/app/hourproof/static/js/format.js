// Figures on screen: thousands commas, two-decimal percents, six-decimal MWh.

export function commaDigits(text) {
  const digits = String(text);
  const negative = digits.startsWith('-');
  const body = negative ? digits.slice(1) : digits;
  let out = '';
  for (let index = 0; index < body.length; index += 1) {
    const fromEnd = body.length - index;
    out += body[index];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ',';
  }
  return (negative ? '-' : '') + out;
}

export function commas(value) {
  return commaDigits(String(value));
}

export function percent(bp) {
  const negative = bp < 0;
  const size = Math.abs(bp);
  const text = `${Math.floor(size / 100)}.${String(size % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

export function points(monthBp, grainBp) {
  return percent(monthBp - grainBp);
}

export function timerText(seconds) {
  const left = Math.max(0, seconds);
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const secs = left % 60;
  return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s left`;
}

export function settlementText(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

export function hourClock(hourUtc) {
  return `${hourUtc.slice(11, 13)}:00`;
}

export function grainWord(grain) {
  return grain.charAt(0).toUpperCase() + grain.slice(1);
}

export function lineRow(line) {
  return (
    `${line.lot_name} ${commas(line.wh)} Wh, range ${commaDigits(line.range_start_wh)}` +
    ` to ${commaDigits(line.range_end_wh)}, ${line.status}`
  );
}
