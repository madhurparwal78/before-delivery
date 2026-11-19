import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

/**
 * Procedurally drawn fixture photographs: 1000x1000 PNGs with legible rims,
 * a distinct mintmark letter at (600,400), and an optional scratch or gouge.
 */
const WIDTH = 1000;
const HEIGHT = 1000;

type Overlay = "none" | "scratch" | "gouge";

function drawCoin(mintmark: string, wear: "fresh" | "worn", overlay: Overlay): Uint8Array {
  const px = new Uint8Array(WIDTH * HEIGHT * 3);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const idx = (y * WIDTH + x) * 3;
    px[idx] = r;
    px[idx + 1] = g;
    px[idx + 2] = b;
  };
  const fill = (r: number, g: number, b: number) => {
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        put(x, y, r, g, b);
      }
    }
  };
  const base = wear === "worn" ? [206, 200, 186] : [225, 219, 205];
  fill(base[0], base[1], base[2]);
  const cx = 500;
  const cy = 500;
  // Coin disc with stroked rim.
  const rimOuter = 430;
  const rimInner = 392;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= rimOuter) {
        if (dist > rimInner) {
          const edgeShade = wear === "worn" ? 120 : 90;
          put(x, y, edgeShade, edgeShade - 4, edgeShade - 12);
        } else {
          const tone = wear === "worn" ? 196 : 214;
          put(x, y, tone, tone - 6, tone - 16);
        }
      }
    }
  }
  // Legend ring
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 370 && dist < 380) {
        const angle = Math.atan2(dy, dx);
        const tick = Math.sin(angle * 48) > 0.6 ? 60 : 150;
        put(x, y, tick, tick, tick - 10);
      }
    }
  }
  // Portrait block
  for (let y = 340; y < 560; y++) {
    for (let x = 320; x < 460; x++) {
      const d = Math.sqrt((x - 390) * (x - 390) + (y - 450) * (y - 450));
      if (d < 95) {
        const shade = d < 80 ? 235 : 170;
        put(x, y, shade, shade - 5, shade - 15);
      }
    }
  }
  // Mintmark letter centred at (600,400): block glyphs keep the letter readable when scaled.
  drawLetter(px, mintmark, 600, 400, 46, 26, wear === "worn" ? 110 : 70, 130);
  // Feature overlays through the mintmark point.
  if (overlay === "scratch") {
    for (let t = -180; t <= 180; t++) {
      const x = 600 + t;
      const y = 400 + Math.round(t / 3);
      for (let w = -2; w <= 2; w++) {
        put(x, y + w, 250, 248, 240);
      }
    }
  }
  if (overlay === "gouge") {
    for (let t = -90; t <= 90; t++) {
      const x = 600 + t;
      const y = 400 + Math.round(t / 2);
      for (let w = -8; w <= 8; w++) {
        const depth = Math.abs(w);
        put(x, y + w, 40 + depth * 6, 38 + depth * 6, 34 + depth * 6);
      }
    }
  }
  return encodePng(px, WIDTH, HEIGHT);
}

function drawLetter(px: Uint8Array, letter: string, cx: number, cy: number, size: number, thickness: number, ink: number, bound: number): void {
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const idx = (y * WIDTH + x) * 3;
    px[idx] = r;
    px[idx + 1] = g;
    px[idx + 2] = b;
  };
  const half = size / 2;
  const halfT = thickness / 2;
  const upper = letter.toUpperCase();
  const strokes: [number, number, number, number][] = [];
  switch (upper) {
    case "A":
      strokes.push([cx - half, cy + half, cx, cy - half], [cx, cy - half, cx + half, cy + half], [cx - half * 0.5, cy, cx + half * 0.5, cy]);
      break;
    case "K":
      strokes.push([cx - half, cy - half, cx - half, cy + half], [cx - half, cy, cx + half, cy - half], [cx - half, cy, cx + half, cy + half]);
      break;
    case "O":
      strokes.push([cx - half, cy - half, cx + half, cy - half], [cx - half, cy + half, cx + half, cy + half], [cx - half, cy - half, cx - half, cy + half], [cx + half, cy - half, cx + half, cy + half]);
      break;
    default:
      strokes.push([cx - half, cy - half, cx + half, cy - half], [cx - half, cy - half, cx - half, cy + half], [cx - half, cy + half, cx + half, cy + half]);
      break;
  }
  for (const [x1, y1, x2, y2] of strokes) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2 + 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = Math.round(x1 + (x2 - x1) * t);
      const sy = Math.round(y1 + (y2 - y1) * t);
      for (let dy = -halfT; dy <= halfT; dy++) {
        for (let dx = -halfT; dx <= halfT; dx++) {
          put(sx + dx, sy + dy, ink, ink, ink + 4);
        }
      }
    }
  }
  void bound;
}

function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      raw.push(rgb[idx], rgb[idx + 1], rgb[idx + 2]);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type, "ascii");
    const crcData = Buffer.concat([typeBuffer, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = deflateSync(Buffer.from(raw), { level: 6 });
  return new Uint8Array(Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]));
}

let crcTable: number[] | null = null;

function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface FixturePhoto {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  sha256: string;
}

export function fixturePhoto(kind: "obverse" | "reverse" | "arrival" | "dispatch", mintmark: string, wear: "fresh" | "worn", overlay: Overlay): FixturePhoto {
  const bytes = drawCoin(mintmark, wear, overlay);
  return {
    bytes,
    contentType: "image/png",
    width: WIDTH,
    height: HEIGHT,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
