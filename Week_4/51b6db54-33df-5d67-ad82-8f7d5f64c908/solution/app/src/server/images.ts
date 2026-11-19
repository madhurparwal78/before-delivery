import { GifReader } from 'omggif';
import { PNG } from 'pngjs';

export interface DecodedImage {
  width: number;
  height: number;
  frames: { rgba: Uint8Array; ms: number }[];
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ImageKind = 'png' | 'gif';

/** The kind and size of an image judged by its bytes alone, never by its name. */
export function sniffImage(data: Buffer): { kind: ImageKind; width: number; height: number } | null {
  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_MAGIC) && data.subarray(12, 16).toString('latin1') === 'IHDR') {
    return { kind: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  const head = data.subarray(0, 6).toString('latin1');
  if (data.length >= 10 && (head === 'GIF87a' || head === 'GIF89a')) return { kind: 'gif', width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  return null;
}

export function decodeImage(data: Buffer, kind: ImageKind): DecodedImage | null {
  try {
    if (kind === 'png') {
      const png = PNG.sync.read(data);
      return { width: png.width, height: png.height, frames: [{ rgba: new Uint8Array(png.data), ms: 100 }] };
    }
    const reader = new GifReader(data);
    const canvas = new Uint8Array(reader.width * reader.height * 4);
    const frames: DecodedImage['frames'] = [];
    let previous: { x: number; y: number; width: number; height: number; disposal: number } | null = null;
    let saved = canvas.slice();
    for (let i = 0; i < reader.numFrames(); i++) {
      if (previous?.disposal === 2) {
        for (let y = previous.y; y < previous.y + previous.height; y++) canvas.fill(0, (y * reader.width + previous.x) * 4, (y * reader.width + previous.x + previous.width) * 4);
      } else if (previous?.disposal === 3) canvas.set(saved);
      const info = reader.frameInfo(i);
      saved = canvas.slice();
      reader.decodeAndBlitFrameRGBA(i, canvas);
      frames.push({ rgba: canvas.slice(), ms: info.delay * 10 });
      previous = info;
    }
    return { width: reader.width, height: reader.height, frames };
  } catch {
    return null;
  }
}
