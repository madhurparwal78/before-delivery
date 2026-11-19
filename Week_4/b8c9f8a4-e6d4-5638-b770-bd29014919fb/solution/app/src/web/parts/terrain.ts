// The procedural road terrain band: an aerial road through wooded hills, generated from a seeded
// noise field and a jittered grid of tree crowns, drawn once when the band first comes into view.

import { el } from '../dom.js';

/** Value noise with smooth cells, summed over octaves so the hills have no blocky steps. */
function hills(seed: number): (x: number, y: number) => number {
  const random = (a: number, b: number): number => {
    const value = Math.sin(a * 127.1 + b * 311.7 + seed) * 43758.5453;
    return value - Math.floor(value);
  };
  const smooth = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const layer = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const top = random(x0, y0) * (1 - fx) + random(x0 + 1, y0) * fx;
    const bottom = random(x0, y0 + 1) * (1 - fx) + random(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  return (x, y) => layer(x, y) * 0.62 + layer(x * 2.1 + 9, y * 2.1 + 4) * 0.27 + layer(x * 4.3 + 3, y * 4.3 + 7) * 0.11;
}

const TREE_CELL = 9;

/** One jittered tree per grid cell: where it stands and how its crown is coloured. */
function plantTrees(width: number, height: number): { columns: number; x: Float32Array; y: Float32Array; tone: Float32Array } {
  const columns = Math.ceil(width / TREE_CELL) + 3;
  const rows = Math.ceil(height / TREE_CELL) + 3;
  const x = new Float32Array(columns * rows);
  const y = new Float32Array(columns * rows);
  const tone = new Float32Array(columns * rows);
  const random = (a: number, b: number, salt: number): number => {
    const value = Math.sin(a * 12.9898 + b * 78.233 + salt) * 24634.6345;
    return value - Math.floor(value);
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = row * columns + column;
      x[at] = (column - 1 + random(column, row, 1.7)) * TREE_CELL;
      y[at] = (row - 1 + random(column, row, 8.3)) * TREE_CELL;
      tone[at] = random(column, row, 21.1);
    }
  }
  return { columns, x, y, tone };
}

function draw(canvas: HTMLCanvasElement): void {
  const box = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(box.width));
  const height = Math.max(160, Math.round(box.height));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.style.background = 'linear-gradient(180deg, #2B2272, #0E0339)';
    return;
  }
  const land = hills(17.37);
  const relief = (x: number, y: number): number => land(x / 210, y / 150);
  const trees = plantTrees(width, height);
  const picture = context.createImageData(width, height);

  // A lane sweeping across the band below the label, as if seen from a low aircraft.
  const laneAt = (x: number): number =>
    height * 0.74 - Math.sin((x / width) * Math.PI) * height * 0.2 + Math.sin(x / 150) * height * 0.035;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // hillshade: the slope of the land, lit from the upper left
      const slope = relief(x + 7, y + 7) - relief(x - 7, y - 7);
      const hillLight = Math.max(0.36, Math.min(1.6, 0.94 - slope * 11));
      const altitude = relief(x, y);

      // the nearest tree's crown, a dome lit from the same side
      const cellX = Math.floor(x / TREE_CELL) + 1;
      const cellY = Math.floor(y / TREE_CELL) + 1;
      let nearest = Infinity;
      let dx = 0;
      let dy = 0;
      let tone = 0;
      for (let row = cellY - 1; row <= cellY + 1; row += 1) {
        for (let column = cellX - 1; column <= cellX + 1; column += 1) {
          const at = row * trees.columns + column;
          const ox = x - trees.x[at];
          const oy = y - trees.y[at];
          const distance = ox * ox + oy * oy;
          if (distance < nearest) {
            nearest = distance;
            dx = ox;
            dy = oy;
            tone = trees.tone[at];
          }
        }
      }
      // Crowns differ in size, and the wood breaks into clumps, so it never reads as a regular grid.
      const clump = land(x / 26 + 40, y / 22 + 11);
      const spread = TREE_CELL * TREE_CELL * (0.45 + tone * 0.75);
      const crown = Math.max(0, 1 - nearest / spread);
      const crownLight = 0.34 + crown * 0.5 + Math.max(-0.16, (-dx - dy) / (TREE_CELL * 2.4)) * crown;
      // Dark conifers at dusk on the low ground, paler broadleaf up the slopes and in the clumps.
      const pale = Math.max(0, Math.min(1, tone * 0.32 + altitude * 0.5 + (clump - 0.5) * 1.5));
      let red = (20 + pale * 66) * crownLight;
      let green = (50 + pale * 74) * crownLight;
      let blue = (46 + pale * 12) * crownLight;

      const toLane = y - laneAt(x);
      const away = Math.abs(toLane);
      const verge = 15 + altitude * 9;
      if (away < verge) {
        // the verge: rough grass, fading out under the trees
        const grass = 1 - Math.max(0, (away - 7) / (verge - 7));
        red += (84 - red) * grass;
        green += (90 - green) * grass;
        blue += (58 - blue) * grass;
      } else if (toLane < 0 && away < verge + 14) {
        // the trees on the lit side throw their shadow towards the lane
        const shade = 0.62 + 0.38 * ((away - verge) / 14);
        red *= shade;
        green *= shade;
        blue *= shade;
      }
      if (away < 5) {
        // the lane itself, paler down its two wheel tracks
        const track = Math.abs(away - 2.5) < 1 ? 1.14 : 1;
        red = 122 * track;
        green = 110 * track;
        blue = 104 * track;
      }

      const at = (y * width + x) * 4;
      picture.data[at] = Math.min(255, red * hillLight);
      picture.data[at + 1] = Math.min(255, green * hillLight);
      picture.data[at + 2] = Math.min(255, blue * hillLight);
      picture.data[at + 3] = 255;
    }
  }
  context.putImageData(picture, 0, 0);
  // Aerial haze in the stage's indigo along the top edge, clear at the bottom against the footer.
  const haze = context.createLinearGradient(0, 0, 0, height);
  haze.addColorStop(0, 'rgba(14, 3, 57, 0.42)');
  haze.addColorStop(0.45, 'rgba(14, 3, 57, 0.1)');
  haze.addColorStop(1, 'rgba(14, 3, 57, 0)');
  context.fillStyle = haze;
  context.fillRect(0, 0, width, height);
  // The band is darkened where the label sits, so the white line keeps its contrast.
  const behindLabel = context.createRadialGradient(
    width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.22,
  );
  behindLabel.addColorStop(0, 'rgba(6, 3, 30, 0.72)');
  behindLabel.addColorStop(0.5, 'rgba(6, 3, 30, 0.42)');
  behindLabel.addColorStop(1, 'rgba(6, 3, 30, 0)');
  context.fillStyle = behindLabel;
  context.fillRect(0, 0, width, height);
}

export function terrainCanvas(viewingArea: string): HTMLElement {
  const canvas = el('canvas', { class: 'terrain-canvas', role: 'img', 'aria-label': 'Road terrain' });
  let drawn = false;
  const paint = (): void => {
    if (drawn) return;
    drawn = true;
    draw(canvas);
  };
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      watcher.disconnect();
      paint();
    }
  }, { rootMargin: '400px' });
  watcher.observe(canvas);
  return el('section', { class: 'terrain-band' }, [
    canvas,
    el('p', { class: 'terrain-label' }, [viewingArea]),
  ]);
}
