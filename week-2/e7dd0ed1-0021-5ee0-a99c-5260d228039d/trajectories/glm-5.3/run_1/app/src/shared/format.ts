// Display formats shared by every screen.
export function fmtInt(n: number | bigint): string {
  return Number(n).toLocaleString('en-US');
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function utcStamp(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function shortVersion(vid: string): string { return vid.slice(0, 8); }
