// Just enough EXIF to answer two questions about an original — which way up is it, and does it
// carry a location — and to write a tag onto the photos the seed draws.

interface ExifFacts {
  orientation: number;
  hasLocation: boolean;
}

const APP1 = 0xffe1;

function findExif(jpeg: Buffer): Buffer | null {
  if (jpeg.length < 4 || jpeg.readUInt16BE(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 4 <= jpeg.length) {
    if (jpeg[at] !== 0xff) return null;
    const marker = jpeg.readUInt16BE(at);
    if (marker === 0xffda || marker === 0xffd9) return null;
    const length = jpeg.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > jpeg.length) return null;
    if (marker === APP1 && jpeg.subarray(at + 4, at + 10).toString('latin1') === 'Exif\0\0') {
      return jpeg.subarray(at + 10, at + 2 + length);
    }
    at += 2 + length;
  }
  return null;
}

export function readExif(file: Buffer): ExifFacts {
  const tiff = findExif(file);
  const none: ExifFacts = { orientation: 1, hasLocation: false };
  if (!tiff || tiff.length < 8) return none;
  const order = tiff.subarray(0, 2).toString('latin1');
  const little = order === 'II';
  if (!little && order !== 'MM') return none;
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 0x2a) return none;
  const first = u32(4);
  if (first + 2 > tiff.length) return none;
  const count = u16(first);
  let orientation = 1;
  let hasLocation = false;
  for (let index = 0; index < count; index += 1) {
    const entry = first + 2 + index * 12;
    if (entry + 12 > tiff.length) break;
    const tag = u16(entry);
    if (tag === 0x0112) orientation = u16(entry + 8) || 1;
    if (tag === 0x8825) hasLocation = true;
  }
  return { orientation: orientation >= 1 && orientation <= 8 ? orientation : 1, hasLocation };
}

/** An APP1 segment carrying an orientation tag and, when asked, a location. */
export function buildExifSegment(orientation: number, withLocation: boolean): Buffer {
  const entries = withLocation ? 2 : 1;
  const gpsAt = 8 + 2 + 12 * entries + 4;
  const parts: Buffer[] = [];
  const header = Buffer.alloc(8);
  header.write('II', 0, 'latin1');
  header.writeUInt16LE(0x2a, 2);
  header.writeUInt32LE(8, 4);
  parts.push(header);

  const ifd = Buffer.alloc(2 + 12 * entries + 4);
  ifd.writeUInt16LE(entries, 0);
  ifd.writeUInt16LE(0x0112, 2);
  ifd.writeUInt16LE(3, 4);
  ifd.writeUInt32LE(1, 6);
  ifd.writeUInt16LE(orientation, 10);
  if (withLocation) {
    ifd.writeUInt16LE(0x8825, 14);
    ifd.writeUInt16LE(4, 16);
    ifd.writeUInt32LE(1, 18);
    ifd.writeUInt32LE(gpsAt, 22);
  }
  parts.push(ifd);

  if (withLocation) {
    const dataAt = gpsAt + 2 + 24 + 4;
    const gps = Buffer.alloc(2 + 24 + 4 + 24);
    gps.writeUInt16LE(2, 0);
    gps.writeUInt16LE(1, 2);
    gps.writeUInt16LE(2, 4);
    gps.writeUInt32LE(2, 6);
    gps.write('N\0', 10, 'latin1');
    gps.writeUInt16LE(2, 14);
    gps.writeUInt16LE(5, 16);
    gps.writeUInt32LE(3, 18);
    gps.writeUInt32LE(dataAt, 22);
    gps.writeUInt32LE(0, 26);
    const rationals = [54, 1, 58, 1, 0, 1];
    rationals.forEach((value, index) => gps.writeUInt32LE(value, 30 + index * 4));
    parts.push(gps);
  }

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), ...parts]);
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(APP1, 0);
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([segment, payload]);
}

/** Puts a segment into a JPEG, after the start marker and any JFIF block. */
export function withExif(jpeg: Buffer, segment: Buffer): Buffer {
  let at = 2;
  if (jpeg.readUInt16BE(2) === 0xffe0) at = 4 + jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.subarray(0, at), segment, jpeg.subarray(at)]);
}
