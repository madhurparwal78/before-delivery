/**
 * Minimal JPEG reader: scan segments for SOF0/SOF1/SOF2 dimensions and APP1
 * Exif orientation. Enough for validating content and stripping metadata.
 */

export interface JpegInfo {
  width: number;
  height: number;
  exifOrientation: number | null;
}

function isApp1Exif(buf: Buffer, offset: number): boolean {
  if (buf.length < offset + 6) return false;
  return buf[offset] === 0x45 && buf[offset + 1] === 0x78 && buf[offset + 2] === 0x69 && buf[offset + 3] === 0x66 && buf[offset + 4] === 0x00 && buf[offset + 5] === 0x00;
}

function readExifOrientation(buf: Buffer, appStart: number, appLength: number): number | null {
  try {
    const le = buf[appStart + 6] === 0x49 && buf[appStart + 7] === 0x49;
    const rd16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
    const rd32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    const tiff = appStart + 6;
    const ifdOffset = rd32(tiff + 4);
    const ifd = tiff + ifdOffset;
    const count = rd16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > appStart + appLength + 2) break;
      if (rd16(entry) === 0x0112) {
        const type = rd16(entry + 2);
        const val = type === 3 ? rd16(entry + 8) : buf[entry + 8];
        return val >= 1 && val <= 8 ? val : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function jpegInfo(buf: Buffer): JpegInfo | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  let info: JpegInfo | null = null;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      info = info ?? { width, height, exifOrientation: null };
      info = { width, height, exifOrientation: info.exifOrientation };
    }
    if (marker === 0xe1 && isApp1Exif(buf, i + 4)) {
      const orientation = readExifOrientation(buf, i + 2, length);
      if (orientation) info = { width: info?.width ?? 0, height: info?.height ?? 0, exifOrientation: orientation };
    }
    i += 2 + length;
  }
  return info;
}
