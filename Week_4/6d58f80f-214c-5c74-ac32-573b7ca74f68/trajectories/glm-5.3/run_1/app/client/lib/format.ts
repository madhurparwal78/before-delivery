export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1000;
    unitIndex++;
  } while (value >= 1000 && unitIndex < units.length - 1);
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

export function formatPhoenixDate(date: string): string {
  return date;
}

export function formatPhoenixTime(instant: string): string {
  const dt = new Date(instant);
  const shifted = new Date(dt.getTime() - 7 * 60 * 60 * 1000);
  const date = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
  const time = `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

export function daysLeftText(daysLeft: number): string {
  return daysLeft === 0 ? 'Last day' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
}

export function binDaysLeftText(daysLeft: number, retentionDays: number, purgePending: boolean): string {
  const rule = `${retentionDays}-day rule`;
  if (purgePending) return `Purge pending · ${rule}`;
  const days = `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
  return `${days} · ${rule}`;
}

export function pluralFiles(n: number): string {
  return `${n} ${n === 1 ? 'file' : 'files'}`;
}

export function pluralLocked(k: number): string {
  return `${k} locked ${k === 1 ? 'file' : 'files'} stayed`;
}

export function iconPath(name: string): string {
  return `/icons/${name}.svg`;
}
