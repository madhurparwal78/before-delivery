/** The camera orientation tag, 1 to 8, or 1 when there is none. */
export function readOrientation(bytes: Buffer): number {
  const tiff = findTiffBlock(bytes);
  return tiff === null ? 1 : orientationIn(bytes, tiff);
}

function findTiffBlock(bytes: Buffer): number | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegTiffBlock(bytes);
  if (bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47) return pngTiffBlock(bytes);
  return null;
}

function jpegTiffBlock(bytes: Buffer): number | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xe1 && bytes.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
      return offset + 10;
    }
    offset += 2 + length;
  }
  return null;
}

function pngTiffBlock(bytes: Buffer): number | null {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (type === 'eXIf') return offset + 8;
    if (type === 'IEND') return null;
    offset += 12 + length;
  }
  return null;
}

function orientationIn(bytes: Buffer, tiff: number): number {
  if (tiff + 8 > bytes.length) return 1;
  const order = bytes.toString('latin1', tiff, tiff + 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return 1;
  const readShort = (at: number): number =>
    little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);
  const readLong = (at: number): number => (little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at));

  const firstIfd = tiff + readLong(tiff + 4);
  if (firstIfd + 2 > bytes.length) return 1;
  const count = readShort(firstIfd);
  for (let index = 0; index < count; index += 1) {
    const entry = firstIfd + 2 + index * 12;
    if (entry + 12 > bytes.length) return 1;
    if (readShort(entry) !== 0x0112) continue;
    const value = readShort(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

export interface Raster {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel. */
  data: Buffer;
}

/** Turns a raster upright for a camera orientation, so its stored size is as displayed. */
export function applyOrientation(image: Raster, orientation: number): Raster {
  if (orientation === 1) return image;
  const { width, height, data } = image;
  const turned = orientation >= 5;
  const outWidth = turned ? height : width;
  const outHeight = turned ? width : height;
  const out = Buffer.alloc(outWidth * outHeight * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let targetX: number;
      let targetY: number;
      switch (orientation) {
        case 2:
          targetX = width - 1 - x;
          targetY = y;
          break;
        case 3:
          targetX = width - 1 - x;
          targetY = height - 1 - y;
          break;
        case 4:
          targetX = x;
          targetY = height - 1 - y;
          break;
        case 5:
          targetX = y;
          targetY = x;
          break;
        case 6:
          targetX = height - 1 - y;
          targetY = x;
          break;
        case 7:
          targetX = height - 1 - y;
          targetY = width - 1 - x;
          break;
        default:
          targetX = y;
          targetY = width - 1 - x;
          break;
      }
      data.copy(out, (targetY * outWidth + targetX) * 4, (y * width + x) * 4, (y * width + x) * 4 + 4);
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}
