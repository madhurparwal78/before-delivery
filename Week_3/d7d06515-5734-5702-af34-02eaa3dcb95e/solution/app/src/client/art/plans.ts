// Floor plans drawn in code for the device preview: a room layout split from one rectangle, with door swings, windows and a dimension line.
import { lerp, round, seeded, type Point } from './geometry.ts';

export interface PlanDrawing {
  /** Wall lines. */
  walls: string;
  /** Door leaves and swings. */
  doors: string;
  /** Window glazing lines on the outer wall. */
  windows: string;
  /** The dimension line under the plan. */
  dimension: string;
  /** Points where selection grips sit. */
  grips: Point[];
}

interface PlanArea { x: number; y: number; width: number; height: number }

const n = round;

export function floorPlan(seed: number, area: PlanArea, depth: number): PlanDrawing {
  const random = seeded(seed);
  const { x, y, width, height } = area;
  const thickness = Math.max(2, Math.min(width, height) * 0.03);
  const walls: string[] = [
    `M${n(x)} ${n(y)}h${n(width)}v${n(height)}h${n(-width)}z`,
    `M${n(x + thickness)} ${n(y + thickness)}h${n(width - 2 * thickness)}v${n(height - 2 * thickness)}h${n(-(width - 2 * thickness))}z`,
  ];
  const doors: string[] = [];
  const minRoom = Math.min(width, height) * 0.28;

  const split = (rx: number, ry: number, rw: number, rh: number, level: number): void => {
    if (level === 0 || (rw < minRoom * 2 && rh < minRoom * 2)) return;
    const vertical = rw >= rh;
    const at = lerp(0.36, 0.64, random());
    const gap = Math.min(vertical ? rh : rw, minRoom) * 0.42;
    const along = lerp(0.18, 0.6, random());
    if (vertical) {
      const sx = rx + rw * at;
      const door = ry + rh * along;
      walls.push(`M${n(sx)} ${n(ry)}V${n(door)}M${n(sx)} ${n(door + gap)}V${n(ry + rh)}`);
      doors.push(`M${n(sx)} ${n(door + gap)}H${n(sx - gap)}M${n(sx)} ${n(door)}A${n(gap)} ${n(gap)} 0 0 0 ${n(sx - gap)} ${n(door + gap)}`);
      split(rx, ry, sx - rx, rh, level - 1);
      split(sx, ry, rx + rw - sx, rh, level - 1);
    } else {
      const sy = ry + rh * at;
      const door = rx + rw * along;
      walls.push(`M${n(rx)} ${n(sy)}H${n(door)}M${n(door + gap)} ${n(sy)}H${n(rx + rw)}`);
      doors.push(`M${n(door)} ${n(sy)}V${n(sy + gap)}M${n(door + gap)} ${n(sy)}A${n(gap)} ${n(gap)} 0 0 1 ${n(door)} ${n(sy + gap)}`);
      split(rx, ry, rw, sy - ry, level - 1);
      split(rx, sy, rw, ry + rh - sy, level - 1);
    }
  };
  split(x + thickness, y + thickness, width - 2 * thickness, height - 2 * thickness, depth);

  const windows: string[] = [];
  const panes = Math.max(2, Math.round(width / 70));
  for (let i = 0; i < panes; i += 1) {
    const wx = x + width * ((i + 0.5) / panes) - width * 0.05;
    windows.push(`M${n(wx)} ${n(y)}v${n(thickness)}M${n(wx + width * 0.1)} ${n(y)}v${n(thickness)}M${n(wx)} ${n(y + thickness / 2)}h${n(width * 0.1)}`);
  }

  const offset = Math.max(8, height * 0.08);
  const dimY = y + height + offset;
  const tick = offset * 0.3;
  return {
    walls: walls.join(''),
    doors: doors.join(''),
    windows: windows.join(''),
    dimension: `M${n(x)} ${n(dimY)}H${n(x + width)}M${n(x)} ${n(dimY - tick)}V${n(dimY + tick)}M${n(x + width)} ${n(dimY - tick)}V${n(dimY + tick)}`,
    grips: [[x, y], [x + width, y], [x + width, y + height]],
  };
}
