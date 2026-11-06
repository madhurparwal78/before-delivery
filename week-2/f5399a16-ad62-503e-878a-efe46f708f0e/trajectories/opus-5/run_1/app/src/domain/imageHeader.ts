/** A file is judged by its own header bytes, never its name or declared type. */
export type ImageHeader = {
  kind: 'png' | 'jpeg';
  contentType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  if (PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    if (bytes.length < 24) return null;
    return {
      kind: 'png',
      contentType: 'image/png',
      width: readUint32(bytes, 16),
      height: readUint32(bytes, 20),
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let index = 2;
    while (index + 9 < bytes.length) {
      if (bytes[index] !== 0xff) {
        index += 1;
        continue;
      }
      const marker = bytes[index + 1] as number;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        index += 2;
        continue;
      }
      const length = readUint16(bytes, index + 2);
      if (JPEG_FRAME_MARKERS.has(marker)) {
        return {
          kind: 'jpeg',
          contentType: 'image/jpeg',
          height: readUint16(bytes, index + 5),
          width: readUint16(bytes, index + 7),
        };
      }
      if (length < 2) return null;
      index += 2 + length;
    }
    return null;
  }
  return null;
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] as number) << 24) |
    ((bytes[at + 1] as number) << 16) |
    ((bytes[at + 2] as number) << 8) |
    (bytes[at + 3] as number)
  );
}

function readUint16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] as number) << 8) | (bytes[at + 1] as number);
}

const ASPECT_RATIOS: Record<string, [number, number]> = {
  '16:9': [16, 9],
  '1:1': [1, 1],
  '9:16': [9, 16],
};

/** Width and height must match the job's aspect exactly. */
export function matchesAspect(width: number, height: number, aspect: string): boolean {
  const ratio = ASPECT_RATIOS[aspect];
  if (!ratio) return false;
  return width * ratio[1] === height * ratio[0];
}
