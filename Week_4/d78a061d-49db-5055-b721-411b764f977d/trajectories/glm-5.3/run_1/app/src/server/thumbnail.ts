import { deflateSync } from 'node:zlib';

/** Minimal PNG writer: 8-bit RGBA, no interlace. */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  const bytes = Buffer.concat([typeBuf, data]);
  for (let i = 0; i < bytes.length; i++) {
    const idx = (crc ^ (bytes[i] ?? 0)) & 0xff;
    crc = (crcTable[idx] ?? 0) ^ (crc >>> 8);
  }
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

export function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(pixels.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, y * (width * 4 + 1) + 1);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

const PAPER: [number, number, number] = [246, 239, 226];
const GRAPHITE: [number, number, number] = [36, 33, 32];

/** A 256x256 graphite-on-paper front silhouette of a stick figure (DP-60 real implementation). */
export function silhouetteThumbnail(): Buffer {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  const set = (x: number, y: number, color: [number, number, number]) => {
    const idx = (y * size + x) * 4;
    pixels[idx] = color[0];
    pixels[idx + 1] = color[1];
    pixels[idx + 2] = color[2];
    pixels[idx + 3] = 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const shade = grain > 0.5 ? 3 : 0;
      set(x, y, [PAPER[0] - shade, PAPER[1] - shade, PAPER[2] - shade]);
    }
  }
  const line = (x0: number, y0: number, x1: number, y1: number, width = 6) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.round(x0 + (x1 - x0) * t);
      const cy = Math.round(y0 + (y1 - y0) * t);
      const half = width / 2;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const px = cx + Math.round(dx);
          const py = cy + Math.round(dy);
          if (px >= 0 && px < size && py >= 0 && py < size && dx * dx + dy * dy <= half * half + half) {
            set(px, py, GRAPHITE);
          }
        }
      }
    }
  };
  const circle = (cx: number, cy: number, r: number, width = 6) => {
    const outer = r + width / 2;
    const inner = r - width / 2;
    for (let y = Math.max(0, cy - Math.ceil(outer)); y < Math.min(size, cy + outer + 1); y++) {
      for (let x = Math.max(0, cx - Math.ceil(outer)); x < Math.min(size, cx + outer + 1); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d >= inner && d <= outer) set(x, y, GRAPHITE);
      }
    }
  };
  circle(128, 62, 28);
  line(128, 92, 128, 162, 7); // spine
  line(128, 108, 78, 138);   // left arm
  line(128, 108, 178, 138);   // right arm
  line(128, 162, 100, 214);   // left leg
  line(128, 162, 156, 214);   // right leg
  return encodePng(size, size, pixels);
}
