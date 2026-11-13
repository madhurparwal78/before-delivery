// Number formatting, time formatting, and the published copy strings.
// One home for every refusal and status text.

export function roundHalfAwayFromZero(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  const scaled = v * f;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  // Math.round ties away from zero for negatives via the sign trick above
  return rounded / f;
}

export function formatFixed(v: number, decimals: number): string {
  const r = roundHalfAwayFromZero(v, decimals);
  if (r === 0) return (0).toFixed(decimals);
  return r.toFixed(decimals);
}

export function formatInt(v: number): string {
  const r = Math.round(v);
  if (r === 0) return '0';
  return String(r);
}

export function formatTimeReadout(frame: number): string {
  const ms = Math.round(frame * 1000 / 60);
  const totalMs = ms;
  const mm = Math.floor(totalMs / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const mmm = totalMs % 1000;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(mmm).padStart(3, '0')}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => {
    const cl = Math.max(0, Math.min(255, Math.round(v)));
    return cl.toString(16).toUpperCase().padStart(2, '0');
  };
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function formatSample(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `#${hex.slice(1).toUpperCase()} · rgb(${r}, ${g}, ${b})`;
}

// --- Time ---------------------------------------------------------------

export function formatDate(iso: string, timeZone: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
