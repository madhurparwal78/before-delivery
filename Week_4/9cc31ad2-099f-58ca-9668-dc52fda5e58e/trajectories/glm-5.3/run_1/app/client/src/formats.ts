// Formats: the single place where display conversions happen.
export const fmtTime = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
};

export const fmtDelta = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '';
  if (ms === 0) return '0.000 s';
  const sign = ms < 0 ? '−' : '+';
  const abs = Math.abs(ms);
  const s = Math.floor(abs / 1000);
  const mm = abs % 1000;
  return `${sign}${s}.${String(mm).padStart(3, '0')} s`;
};

export const fmtCoins = (n: number | null | undefined): string =>
  (n ?? 0).toLocaleString('en-US');

export const fmtSpeed = (mps: number, units: 'kmh' | 'mph'): string => {
  const v = units === 'kmh' ? mps * 3.6 : mps * 2.23694;
  return String(Math.round(v));
};

export const fmtScore = (n: number): string => n.toLocaleString('en-US');

export const fmtAccel = (v: number): string => `${v.toFixed(1)} m/s²`;
export const fmtBrake = (v: number): string => `${v.toFixed(1)} m/s²`;
export const fmtGrip = (v: number): string => `${Math.round(v)}%`;
export const fmtSteps = (v: number): string => `${Math.round(v)} steps`;
