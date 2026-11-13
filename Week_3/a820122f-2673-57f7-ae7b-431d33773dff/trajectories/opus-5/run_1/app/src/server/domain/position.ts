export type PositionFix = {
  id: string;
  atMs: number;
  latitude: number;
  longitude: number;
};

export type Position = { latitude: number; longitude: number };

const DEGREES = Math.PI / 180;

function toVector(fix: Position): [number, number, number] {
  const lat = fix.latitude * DEGREES;
  const lon = fix.longitude * DEGREES;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

function toPosition(vector: [number, number, number]): Position {
  const [x, y, z] = vector;
  const hypotenuse = Math.sqrt(x * x + y * y);
  return {
    latitude: Math.atan2(z, hypotenuse) / DEGREES,
    longitude: Math.atan2(y, x) / DEGREES,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The great-circle position at an instant, interpolated between the fixes either side. */
export function positionAt(fixes: PositionFix[], ms: number): Position | null {
  if (fixes.length === 0) return null;
  const ordered = [...fixes].sort((a, b) => a.atMs - b.atMs);
  const first = ordered[0] as PositionFix;
  const last = ordered[ordered.length - 1] as PositionFix;
  if (ms <= first.atMs) return { latitude: round2(first.latitude), longitude: round2(first.longitude) };
  if (ms >= last.atMs) return { latitude: round2(last.latitude), longitude: round2(last.longitude) };
  let before = first;
  let after = last;
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const current = ordered[i] as PositionFix;
    const next = ordered[i + 1] as PositionFix;
    if (ms >= current.atMs && ms <= next.atMs) {
      before = current;
      after = next;
      break;
    }
  }
  if (ms === before.atMs) return { latitude: round2(before.latitude), longitude: round2(before.longitude) };
  const fraction = (ms - before.atMs) / (after.atMs - before.atMs);
  const start = toVector(before);
  const end = toVector(after);
  const dot = Math.min(1, Math.max(-1, start[0] * end[0] + start[1] * end[1] + start[2] * end[2]));
  const angle = Math.acos(dot);
  if (angle < 1e-9) return { latitude: round2(before.latitude), longitude: round2(before.longitude) };
  const a = Math.sin((1 - fraction) * angle) / Math.sin(angle);
  const b = Math.sin(fraction * angle) / Math.sin(angle);
  const mixed: [number, number, number] = [
    a * start[0] + b * end[0],
    a * start[1] + b * end[1],
    a * start[2] + b * end[2],
  ];
  const position = toPosition(mixed);
  return { latitude: round2(position.latitude), longitude: round2(position.longitude) };
}
