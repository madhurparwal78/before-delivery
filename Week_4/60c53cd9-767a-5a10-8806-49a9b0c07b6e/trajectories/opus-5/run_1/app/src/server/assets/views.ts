/**
 * The seeded view photographs and the two stored textures. Each photograph is a
 * full-colour skyline centred on the stack's bearing, with the horizon sitting
 * lower in higher bands.
 */

import { encodePng } from './image';
import type { BandId, StackLetter, ViewTag } from '../../shared/units';

const WIDTH = 1024;
const HEIGHT = 512;

type Rgb = readonly [number, number, number];

class Raster {
  readonly data: Buffer;

  constructor(readonly width: number, readonly height: number) {
    this.data = Buffer.alloc(width * height * 3);
  }

  set(x: number, y: number, colour: Rgb, alpha = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const existing = this.data[offset + channel];
      this.data[offset + channel] = Math.round(existing * (1 - alpha) + colour[channel] * alpha);
    }
  }

  rect(x: number, y: number, width: number, height: number, colour: Rgb, alpha = 1): void {
    const left = Math.max(0, Math.floor(x));
    const right = Math.min(this.width, Math.floor(x + width));
    const top = Math.max(0, Math.floor(y));
    const bottom = Math.min(this.height, Math.floor(y + height));
    if (right <= left || bottom <= top) return;
    if (alpha < 1) {
      for (let row = top; row < bottom; row += 1) {
        for (let column = left; column < right; column += 1) this.set(column, row, colour, alpha);
      }
      return;
    }
    const start = (top * this.width + left) * 3;
    const span = (right - left) * 3;
    for (let offset = start; offset < start + span; offset += 3) {
      this.data[offset] = colour[0];
      this.data[offset + 1] = colour[1];
      this.data[offset + 2] = colour[2];
    }
    for (let row = top + 1; row < bottom; row += 1) {
      this.data.copy(this.data, (row * this.width + left) * 3, start, start + span);
    }
  }

  disc(centreX: number, centreY: number, radius: number, colour: Rgb, alpha = 1): void {
    for (let row = Math.floor(centreY - radius); row <= centreY + radius; row += 1) {
      for (let column = Math.floor(centreX - radius); column <= centreX + radius; column += 1) {
        const dx = column - centreX;
        const dy = row - centreY;
        if (dx * dx + dy * dy <= radius * radius) this.set(column, row, colour, alpha);
      }
    }
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.data);
  }
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function seededRandom(seed: string): () => number {
  let state = 0x811c9dc5;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const HORIZON_BY_BAND: Record<BandId, number> = {
  '03-09': 0.66,
  '10-19': 0.6,
  '20-29': 0.54,
  '30-35': 0.47,
  '36-38': 0.42,
};

function skyline(raster: Raster, horizon: number, random: () => number, palette: Rgb, rows: number): void {
  for (let layer = 0; layer < rows; layer += 1) {
    const depth = layer / Math.max(1, rows - 1);
    const colour = mix(mix(palette, [226, 232, 240], 0.65), palette, depth);
    let x = -40 + random() * 30;
    while (x < WIDTH) {
      const width = 24 + random() * 90;
      const height = (14 + random() * 120) * (0.45 + depth);
      const top = horizon - height;
      raster.rect(x, top, width, height + 4, colour);
      if (depth > 0.5) {
        for (let wy = top + 6; wy < horizon - 6; wy += 11) {
          for (let wx = x + 5; wx < x + width - 5; wx += 9) {
            if (random() > 0.45) raster.rect(wx, wy, 4, 5, mix(colour, [255, 236, 170], 0.6));
          }
        }
      }
      x += width + 4 + random() * 12;
    }
  }
}

function hills(raster: Raster, horizon: number, random: () => number): void {
  for (let layer = 0; layer < 4; layer += 1) {
    const depth = layer / 3;
    const colour = mix([120, 148, 118], [38, 70, 48], depth);
    const amplitude = 60 + depth * 70;
    const base = horizon + depth * 26;
    let phase = random() * 6;
    for (let x = 0; x < WIDTH; x += 1) {
      phase += 0.0135 + depth * 0.004;
      const top = base - (Math.sin(phase) * 0.5 + 0.5) * amplitude - 10;
      raster.rect(x, top, 1, HEIGHT - top, colour);
    }
  }
}

function trees(raster: Raster, horizon: number, random: () => number): void {
  raster.rect(0, horizon, WIDTH, HEIGHT - horizon, [74, 112, 64]);
  for (let index = 0; index < 220; index += 1) {
    const x = random() * WIDTH;
    const y = horizon + random() * (HEIGHT - horizon);
    const radius = 10 + random() * 30 * ((y - horizon) / (HEIGHT - horizon) + 0.3);
    raster.disc(x, y, radius, mix([52, 92, 50], [136, 174, 92], random()));
  }
  for (let index = 0; index < 14; index += 1) {
    const x = random() * WIDTH;
    raster.rect(x, horizon + 20, 3 + random() * 60, 6, [166, 186, 140], 0.55);
  }
}

function water(raster: Raster, horizon: number, random: () => number): void {
  for (let y = Math.floor(horizon); y < HEIGHT; y += 1) {
    const depth = (y - horizon) / (HEIGHT - horizon);
    raster.rect(0, y, WIDTH, 1, mix([92, 146, 176], [26, 62, 106], depth));
  }
  for (let index = 0; index < 320; index += 1) {
    const y = horizon + random() * (HEIGHT - horizon);
    const x = random() * WIDTH;
    const length = 8 + random() * 70;
    raster.rect(x, y, length, 1 + random() * 2, [222, 238, 246], 0.18 + random() * 0.25);
  }
  for (let index = 0; index < 5; index += 1) {
    const x = 80 + random() * (WIDTH - 160);
    const y = horizon + 30 + random() * (HEIGHT - horizon - 80);
    raster.rect(x, y, 26 + random() * 40, 5, [250, 250, 250], 0.9);
    raster.rect(x + 10, y - 12, 4, 12, [250, 250, 250], 0.9);
  }
}

/** The invented 24-storey Calder House block that half blocks the harbour. */
function calderHouse(raster: Raster, horizon: number, random: () => number): void {
  const left = WIDTH * 0.34;
  const width = WIDTH * 0.5;
  const top = horizon - 170;
  raster.rect(left, top, width, HEIGHT - top, [108, 106, 118]);
  raster.rect(left, top, width, 10, [138, 136, 148]);
  for (let storey = 0; storey < 24; storey += 1) {
    const y = top + 14 + storey * 16;
    if (y > HEIGHT - 10) break;
    for (let column = 0; column < 18; column += 1) {
      const x = left + 12 + column * (width - 24) / 18;
      raster.rect(x, y, (width - 24) / 18 - 6, 9, random() > 0.5 ? [84, 92, 104] : [168, 180, 192]);
    }
  }
}

export function renderViewPhotograph(input: { band: BandId; stack: StackLetter; bearing: number; viewTag: ViewTag }): Buffer {
  const raster = new Raster(WIDTH, HEIGHT);
  const random = seededRandom(`${input.band}-${input.stack}-${input.viewTag}`);
  const horizon = Math.round(HEIGHT * HORIZON_BY_BAND[input.band]);
  const warmth = (Math.cos((input.bearing * Math.PI) / 180) + 1) / 2;
  const skyTop = mix([38, 74, 148], [26, 54, 120], warmth);
  const skyBottom = mix([188, 212, 238], [244, 214, 182], warmth);
  for (let y = 0; y < horizon; y += 1) {
    raster.rect(0, y, WIDTH, 1, mix(skyTop, skyBottom, y / horizon));
  }
  const sunX = ((input.bearing / 360) * WIDTH + WIDTH / 2) % WIDTH;
  raster.disc(sunX, horizon * 0.42, 46, mix([255, 246, 214], skyBottom, 0.25), 0.65);
  for (let index = 0; index < 26; index += 1) {
    const y = random() * horizon * 0.8;
    raster.rect(random() * WIDTH - 100, y, 120 + random() * 260, 6 + random() * 18, [255, 255, 255], 0.14);
  }

  switch (input.viewTag) {
    case 'harbour':
      skyline(raster, horizon, random, [96, 110, 132], 1);
      water(raster, horizon, random);
      break;
    case 'harbour-partial':
      skyline(raster, horizon, random, [96, 110, 132], 1);
      water(raster, horizon, random);
      calderHouse(raster, horizon, random);
      break;
    case 'park':
      skyline(raster, horizon, random, [118, 126, 148], 1);
      trees(raster, horizon, random);
      break;
    case 'city':
      skyline(raster, horizon, random, [84, 96, 126], 3);
      raster.rect(0, horizon, WIDTH, HEIGHT - horizon, [72, 78, 96]);
      skyline(raster, HEIGHT, random, [96, 104, 128], 2);
      break;
    case 'ridge':
      hills(raster, horizon, random);
      break;
  }
  return raster.toPng();
}

export function viewPhotographKey(band: BandId, stack: StackLetter): string {
  return `views/bands/${band}/${stack}.png`;
}

export const TEXTURE_KEYS = {
  facade: 'textures/facade.png',
  ramp: 'textures/duotone-ramp.png',
} as const;

/** The facade texture: flat two-tone window bands, no glass and no gradients. */
export function renderFacadeTexture(): Buffer {
  const size = 512;
  const raster = new Raster(size, size);
  raster.rect(0, 0, size, size, [36, 43, 158]);
  for (let storey = 0; storey < 16; storey += 1) {
    const y = storey * 32;
    raster.rect(0, y, size, 20, [52, 60, 190]);
    for (let column = 0; column < 16; column += 1) {
      raster.rect(column * 32 + 6, y + 4, 20, 12, [36, 43, 158]);
    }
  }
  return raster.toPng();
}

/** The duotone ramp: ground ultramarine to white, used by the tower's two-tone shader. */
export function renderDuotoneRamp(): Buffer {
  const width = 256;
  const height = 4;
  const raster = new Raster(width, height);
  for (let x = 0; x < width; x += 1) {
    const colour = mix([33, 40, 150], [255, 255, 255], x / (width - 1));
    raster.rect(x, 0, 1, height, colour);
  }
  return raster.toPng();
}
