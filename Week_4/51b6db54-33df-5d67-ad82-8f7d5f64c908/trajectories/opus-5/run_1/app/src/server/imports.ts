import { GifReader } from 'omggif';
import { PNG } from 'pngjs';
import { formatColour } from '../shared/colour.js';
import { config } from './config.js';
import { unprocessable } from './errors.js';
import type { Ctx } from './http.js';

export interface DecodedFrame {
  rgba: Uint8Array;
  duration_ms: number;
}

export interface DecodedImage {
  width: number;
  height: number;
  frames: DecodedFrame[];
  colours: string[];
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function clampDuration(ms: number): number {
  return Math.min(Math.max(ms, config.frameMinMs), config.frameMaxMs);
}

function decode(bytes: Buffer): { width: number; height: number; frames: DecodedFrame[] } | null {
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    try {
      const png = PNG.sync.read(bytes);
      return {
        width: png.width,
        height: png.height,
        frames: [{ rgba: new Uint8Array(png.data), duration_ms: clampDuration(100) }],
      };
    } catch {
      return null;
    }
  }
  if (bytes.subarray(0, 3).toString('latin1') === 'GIF') {
    try {
      const reader = new GifReader(new Uint8Array(bytes));
      const canvas = new Uint8Array(reader.width * reader.height * 4);
      const frames: DecodedFrame[] = [];
      for (let at = 0; at < reader.numFrames(); at += 1) {
        reader.decodeAndBlitFrameRGBA(at, canvas);
        frames.push({
          rgba: new Uint8Array(canvas),
          duration_ms: clampDuration(reader.frameInfo(at).delay * 10),
        });
      }
      return { width: reader.width, height: reader.height, frames };
    } catch {
      return null;
    }
  }
  return null;
}

/** Limits judge decoded content, never the file name or stated type. */
export function decodeImport(ctx: Ctx, bytes: Buffer): DecodedImage {
  const decoded = decode(bytes);
  if (decoded === null) throw unprocessable({ file: 'Not a PNG or GIF image' });
  if (bytes.length > config.importMaxBytes) {
    throw unprocessable({ file: `File is larger than ${ctx.num(config.importMaxBytes)} bytes` });
  }
  if (decoded.width > config.spriteMax || decoded.height > config.spriteMax) {
    throw unprocessable({
      file: `Image is ${ctx.num(decoded.width)} by ${ctx.num(decoded.height)}, limit ${ctx.num(config.spriteMax)}`,
    });
  }
  const colours: string[] = [];
  const seen = new Set<string>();
  for (const frame of decoded.frames) {
    for (let cell = 0; cell < decoded.width * decoded.height; cell += 1) {
      const at = cell * 4;
      if (frame.rgba[at + 3] === 0) continue;
      const colour = formatColour([
        frame.rgba[at],
        frame.rgba[at + 1],
        frame.rgba[at + 2],
        frame.rgba[at + 3],
      ]);
      if (seen.has(colour)) continue;
      seen.add(colour);
      colours.push(colour);
    }
  }
  if (colours.length > config.paletteMax) {
    throw unprocessable({
      file: `Needs ${ctx.num(colours.length)} colours, limit ${ctx.num(config.paletteMax)}`,
    });
  }
  return { ...decoded, colours };
}

export interface MultipartFile {
  fieldName: string;
  fileName: string;
  bytes: Buffer;
}

/** The one multipart form field imports use. */
export function parseMultipart(raw: Buffer, contentType: string): MultipartFile | null {
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  if (match === null) return null;
  const boundary = Buffer.from(`--${match[1]}`);
  let at = raw.indexOf(boundary);
  while (at !== -1) {
    const start = at + boundary.length;
    const next = raw.indexOf(boundary, start);
    if (next === -1) break;
    const part = raw.subarray(start, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const body = part.subarray(headerEnd + 4, part.length - 2);
      const nameMatch = headers.match(/name="([^"]+)"/i);
      const fileMatch = headers.match(/filename="([^"]*)"/i);
      if (nameMatch !== null && fileMatch !== null) {
        return { fieldName: nameMatch[1], fileName: fileMatch[1], bytes: Buffer.from(body) };
      }
    }
    at = next;
  }
  return null;
}
