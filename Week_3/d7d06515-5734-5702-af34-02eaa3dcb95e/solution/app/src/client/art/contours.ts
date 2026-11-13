// A dense contour site plan generated from a height field: marching squares over a few overlapping hills.
import { lerp, round, seeded, type Point } from './geometry.ts';

interface ContourMap {
  /** Contour lines every level but the major ones. */
  minor: string;
  /** Every fifth level, drawn white. */
  major: string;
  /** Building footprints and access roads. */
  features: string;
}

interface Hill { x: number; y: number; spread: number; height: number }

export function contourMap(seed: number, width: number, height: number, cell: number, levels: number): ContourMap {
  const random = seeded(seed);
  const hills: Hill[] = Array.from({ length: 7 }, () => ({
    x: random() * width,
    y: random() * height,
    spread: lerp(0.12, 0.3, random()) * width,
    height: lerp(0.5, 1, random()),
  }));
  const field = (x: number, y: number): number => {
    let value = 0;
    for (const hill of hills) value += hill.height * Math.exp(-(((x - hill.x) ** 2 + (y - hill.y) ** 2) / (2 * hill.spread ** 2)));
    return value + 0.08 * Math.sin(x / 23 + Math.sin(y / 31)) + 0.06 * Math.sin(y / 17 + x / 41);
  };

  const columns = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const samples: number[][] = [];
  let low = Infinity;
  let high = -Infinity;
  for (let r = 0; r < rows; r += 1) {
    const row: number[] = [];
    for (let c = 0; c < columns; c += 1) {
      const value = field(c * cell, r * cell);
      row.push(value);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    samples.push(row);
  }

  const at = (r: number, c: number): number => samples[r]?.[c] ?? 0;
  const minor: string[] = [];
  const major: string[] = [];
  for (let level = 1; level <= levels; level += 1) {
    const threshold = lerp(low, high, level / (levels + 1));
    const into = level % 5 === 0 ? major : minor;
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < columns - 1; c += 1) {
        const corners = [at(r, c), at(r, c + 1), at(r + 1, c + 1), at(r + 1, c)];
        const code = corners.reduce((sum, v, i) => sum + (v > threshold ? 1 << i : 0), 0);
        if (code === 0 || code === 15) continue;
        const x = c * cell;
        const y = r * cell;
        const edge = (i: number): Point => {
          const a = corners[i] ?? 0;
          const b = corners[(i + 1) % 4] ?? 0;
          const t = (threshold - a) / (b - a);
          if (i === 0) return [x + t * cell, y];
          if (i === 1) return [x + cell, y + t * cell];
          if (i === 2) return [x + cell - t * cell, y + cell];
          return [x, y + cell - t * cell];
        };
        const crossed: number[] = [];
        for (let i = 0; i < 4; i += 1) if (((code >> i) & 1) !== ((code >> ((i + 1) % 4)) & 1)) crossed.push(i);
        for (let i = 0; i + 1 < crossed.length; i += 2) {
          const first = edge(crossed[i] ?? 0);
          const second = edge(crossed[i + 1] ?? 0);
          into.push(`M${round(first[0])} ${round(first[1])}L${round(second[0])} ${round(second[1])}`);
        }
      }
    }
  }

  const features: string[] = [];
  for (let i = 0; i < 26; i += 1) {
    const bx = random() * (width - 24);
    const by = random() * (height - 18);
    const bw = lerp(5, 11, random());
    const bh = lerp(4, 8, random());
    features.push(`M${round(bx)} ${round(by)}h${round(bw)}v${round(bh)}h${round(-bw)}z`);
  }
  for (let i = 0; i < 4; i += 1) {
    let x = random() * width * 0.3;
    let y = random() * height;
    let d = `M${round(x)} ${round(y)}`;
    for (let s = 0; s < 9; s += 1) {
      x += lerp(18, 34, random());
      y += lerp(-22, 22, random());
      d += `L${round(x)} ${round(y)}`;
    }
    features.push(d);
  }
  return { minor: minor.join(''), major: major.join(''), features: features.join('') };
}
