import { encodePng, type Rgb } from './png.js';

const WIDTH = 720;
const HEIGHT = 480;

const GROUND: Rgb = { r: 12, g: 13, b: 10 };
const INK: Rgb = { r: 232, g: 226, b: 211 };
const ACCENT: Rgb = { r: 214, g: 94, b: 30 };

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return { r: a.r + (b.r - a.r) * amount, g: a.g + (b.g - a.g) * amount, b: a.b + (b.b - a.b) * amount };
}

/**
 * Three procedural plates per chapter: a ruled wheel diagram, a lattice of logical cells
 * and a drifting shard field, each tinted by the chapter number.
 */
export function renderPlate(chapterNumber: number, plateIndex: number): Buffer {
  const phase = (chapterNumber * 37 + plateIndex * 91) % 360;
  return encodePng(WIDTH, HEIGHT, (x, y) => {
    const centreX = WIDTH / 2;
    const centreY = HEIGHT / 2;
    const dx = x - centreX;
    const dy = y - centreY;
    const radius = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const vignette = Math.max(0, 1 - radius / (WIDTH * 0.75));
    let value = 0.04 + vignette * 0.05;
    let tint = INK;

    if (plateIndex === 0) {
      const teeth = 18 + (chapterNumber % 5) * 6;
      const ring = Math.abs(((radius + phase) % 64) - 32) / 32;
      const tooth = Math.abs(Math.sin(angle * teeth + phase / 40));
      value += (1 - ring) * 0.35 + (radius < 150 ? tooth * 0.3 : 0);
      if (Math.abs(radius - 150) < 1.4) tint = ACCENT;
    } else if (plateIndex === 1) {
      const cell = 40;
      const gridX = Math.abs((x % cell) - cell / 2) / (cell / 2);
      const gridY = Math.abs((y % cell) - cell / 2) / (cell / 2);
      const occupied = (Math.floor(x / cell) * 31 + Math.floor(y / cell) * 17 + chapterNumber * 13) % 7 < 3;
      value += (1 - Math.min(gridX, gridY)) * 0.18 + (occupied ? 0.28 : 0.02);
      if (occupied && gridX < 0.25 && gridY < 0.25) tint = ACCENT;
    } else {
      for (let shard = 0; shard < 26; shard += 1) {
        const seed = shard * 97 + chapterNumber * 11 + phase;
        const shardX = ((seed * 37) % WIDTH) + Math.sin(seed) * 40;
        const shardY = ((seed * 53) % HEIGHT) + Math.cos(seed) * 30;
        const distance = Math.hypot(x - shardX, y - shardY);
        if (distance < 26) value += (1 - distance / 26) ** 2 * 0.5;
      }
      if (Math.abs(y - HEIGHT / 2 - Math.sin(x / 60 + phase / 30) * 40) < 1.6) tint = ACCENT;
    }

    const framed = x < 10 || y < 10 || x > WIDTH - 11 || y > HEIGHT - 11;
    if (framed) return mix(GROUND, INK, 0.22);
    return mix(GROUND, tint, Math.min(0.92, Math.max(0, value)));
  });
}

export function plateCaption(chapterNumber: number, plateIndex: number): string {
  const captions = [
    'Plate 1: a geared wheel, ruled from the centre outward.',
    'Plate 2: a lattice of logical cells, half of them lit.',
    'Plate 3: the shard field adrift, before the sightline gathers it.',
  ];
  return `${captions[plateIndex] ?? 'Plate.'} Chapter ${chapterNumber} study.`;
}
