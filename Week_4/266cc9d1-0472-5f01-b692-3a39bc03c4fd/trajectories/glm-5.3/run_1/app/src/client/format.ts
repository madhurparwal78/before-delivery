/** Number and date formatting. The published formats, in one place. */

export function chainage1(v: number): string {
  return `${v.toFixed(1)} m`;
}

export function metres2(v: number): string {
  return `${v.toFixed(2)} m`;
}

export function chainageReadout(v: number): string {
  return `Chainage ${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;
}

export function withCommas(v: number): string {
  return v.toLocaleString('en-US');
}

export function plural(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : noun === 'finding' ? 'findings' : noun + 's'}`;
}

export function findingNoun(n: number): string {
  return n === 1 ? 'finding' : 'findings';
}

export function violationNoun(n: number): string {
  return n === 1 ? 'violation' : 'violations';
}

export function fileNoun(n: number): string {
  return n === 1 ? 'file' : 'files';
}

export function summaryLine(n: number, v: number): string {
  return `${n} ${findingNoun(n)} · ${v} ${violationNoun(v)}`;
}

export function expiryLine(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `Link expires ${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} (${timeZone})`;
}

export function dueLine(date: string, timeZone: string): string {
  return `Inspection due ${date} (${timeZone})`;
}

export function droneLine(lon: number, lat: number, h: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `Drone ${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}, ${h.toFixed(1)} m`;
}

export function flightTimeLine(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `Flight time ${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

export function cameraLine(h: number, heading: number, pitch: number): string {
  return `Camera ${h.toFixed(1)} m above ground, heading ${heading.toFixed(1)}°, pitch ${pitch.toFixed(1)}°`;
}

export function statusWord(status: 'violation' | 'clear'): string {
  return status === 'violation' ? 'Violation' : 'Clear';
}

export function stateWord(state: string): string {
  switch (state) {
    case 'draft': return 'Draft';
    case 'submitted': return 'Submitted';
    case 'under_review': return 'Under review';
    case 'accepted': return 'Accepted';
    case 'disputed': return 'Disputed';
    case 'closed': return 'Closed';
    default: return state;
  }
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'tileset': return 'Tileset';
    case 'terrain': return 'Terrain';
    case 'czml': return 'Flight track';
    default: return kind;
  }
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
