import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

const WIDTH = 480;
const HEIGHT = 360;
const DOT_STEP = 6;
const PAPER = 0xf3;
const INK = 0x25;

interface Shape {
  x: number;
  y: number;
  width: number;
  height: number;
  density: number;
}

function chunk(kind: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const named = Buffer.concat([Buffer.from(kind, "latin1"), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(named));
  return Buffer.concat([length, named, check]);
}

function grayPng(pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = Buffer.alloc((WIDTH + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) rows.set(pixels.subarray(y * WIDTH, (y + 1) * WIDTH), y * (WIDTH + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

function stamp(pixels: Uint8Array, cx: number, cy: number, radius: number): void {
  for (let y = Math.max(0, cy - radius); y <= Math.min(HEIGHT - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(WIDTH - 1, cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) pixels[y * WIDTH + x] = INK;
    }
  }
}

/** A generated before or after photograph of a seeded piece: the same dot primitive as the desk's drawings, the same bytes every time. */
export function seedPhotograph(title: string, side: "before" | "after"): Buffer {
  const hash = createHash("sha256").update(`${title}:${side}`).digest();
  const lean = (hash[0] as number) % 40;
  const shapes: Shape[] = [
    { x: 150 + lean, y: 70, width: 150, height: 130, density: side === "after" ? 0.8 : 0.45 },
    { x: 110, y: 190, width: 240, height: 50, density: side === "after" ? 0.9 : 0.55 },
    { x: 120, y: 240, width: 16, height: 90, density: 1 },
    { x: 324, y: 240, width: 16, height: 90, density: 1 },
  ];
  const pixels = new Uint8Array(WIDTH * HEIGHT).fill(PAPER);
  let noise = hash.readUInt32BE(4);
  const random = (): number => {
    noise = (noise * 1664525 + 1013904223) >>> 0;
    return noise / 2 ** 32;
  };
  for (let y = 0; y < HEIGHT; y += DOT_STEP) {
    for (let x = 0; x < WIDTH; x += DOT_STEP) {
      const inside = shapes.find((shape) => x >= shape.x && x < shape.x + shape.width && y >= shape.y && y < shape.y + shape.height);
      if (inside && random() < inside.density) stamp(pixels, x, y, 2);
    }
  }
  return grayPng(pixels);
}
