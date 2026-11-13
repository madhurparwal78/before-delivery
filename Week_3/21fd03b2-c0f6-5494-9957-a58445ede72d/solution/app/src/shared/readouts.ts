import type { RigKind } from "./params";

interface ReadoutRow {
  label: string;
  value: string;
}

/** Parameter values in effect on screen; null marks a field that holds an invalid entry. */
export type Effective = Record<string, number | null>;

const RAD = Math.PI / 180;
const NA = "n/a";

/** Two decimals, half away from zero. */
function fixed2(value: number): string {
  const text = Math.abs(value).toFixed(2);
  return value < 0 && Number(text) !== 0 ? `-${text}` : text;
}

function row(label: string, value: number | null, unit: string): ReadoutRow {
  return { label, value: value === null || !Number.isFinite(value) ? NA : `${fixed2(value)} ${unit}` };
}

function present(...values: Array<number | null>): boolean {
  return values.every((v) => v !== null);
}

export function readoutsFor(kind: RigKind | "model", p: Effective, gravity: number | null): ReadoutRow[] {
  if (kind === "ramp") {
    const ok = gravity !== null && present(p.mass_kg ?? null, p.angle_deg ?? null, p.length_m ?? null, p.friction ?? null);
    if (!ok) return [row("Potential energy", null, "J"), row("Speed at bottom", null, "m/s"), row("Time to bottom", null, "s")];
    const g = gravity as number;
    const angle = (p.angle_deg as number) * RAD;
    const length = p.length_m as number;
    const friction = p.friction as number;
    const height = length * Math.sin(angle);
    const accel = g * (Math.sin(angle) - friction * Math.cos(angle));
    return [
      row("Potential energy", (p.mass_kg as number) * g * height, "J"),
      row("Speed at bottom", accel > 0 ? Math.sqrt(2 * accel * length) : 0, "m/s"),
      row("Time to bottom", accel > 0 ? Math.sqrt((2 * length) / accel) : null, "s"),
    ];
  }
  if (kind === "pendulum") {
    const length = p.length_m ?? null;
    const release = p.release_deg ?? null;
    return [
      row("Period", gravity !== null && length !== null ? 2 * Math.PI * Math.sqrt(length / gravity) : null, "s"),
      row("Speed at bottom", gravity !== null && length !== null && release !== null ? Math.sqrt(2 * gravity * length * (1 - Math.cos(release * RAD))) : null, "m/s"),
    ];
  }
  if (kind === "launcher") {
    const speed = p.speed_mps ?? null;
    const angle = p.launch_angle_deg ?? null;
    const height = p.height_m ?? null;
    if (gravity === null || speed === null || angle === null || height === null) {
      return [row("Time of flight", null, "s"), row("Range", null, "m"), row("Peak height", null, "m")];
    }
    const vy = speed * Math.sin(angle * RAD);
    const vx = speed * Math.cos(angle * RAD);
    const flight = (vy + Math.sqrt(vy * vy + 2 * gravity * height)) / gravity;
    return [row("Time of flight", flight, "s"), row("Range", vx * flight, "m"), row("Peak height", height + (vy * vy) / (2 * gravity), "m")];
  }
  return [];
}
