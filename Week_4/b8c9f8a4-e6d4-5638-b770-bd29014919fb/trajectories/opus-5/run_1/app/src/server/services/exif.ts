const GPS_IFD_POINTER = 0x8825;

interface TiffCursor {
  readonly data: Buffer;
  readonly littleEndian: boolean;
}

const readU16 = (c: TiffCursor, at: number): number =>
  c.littleEndian ? c.data.readUInt16LE(at) : c.data.readUInt16BE(at);

const readU32 = (c: TiffCursor, at: number): number =>
  c.littleEndian ? c.data.readUInt32LE(at) : c.data.readUInt32BE(at);

/** Finds the TIFF header inside a raw EXIF block, which may carry the `Exif\0\0` prefix. */
const openTiff = (exif: Buffer): TiffCursor | null => {
  for (const start of [0, 6]) {
    if (exif.length < start + 8) continue;
    const marker = exif.toString('latin1', start, start + 2);
    if (marker !== 'II' && marker !== 'MM') continue;
    return { data: exif.subarray(start), littleEndian: marker === 'II' };
  }
  return null;
};

/** True when the original holds GPS data. */
export const hasGpsData = (exif: Buffer | undefined): boolean => {
  if (exif === undefined) return false;
  const cursor = openTiff(exif);
  if (cursor === null) return false;
  const ifd0 = readU32(cursor, 4);
  if (ifd0 + 2 > cursor.data.length) return false;
  const count = readU16(cursor, ifd0);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > cursor.data.length) return false;
    if (readU16(cursor, entry) === GPS_IFD_POINTER) return true;
  }
  return false;
};

const BYTE = 1;
const ASCII = 2;
const LONG = 4;
const RATIONAL = 5;

interface Entry {
  tag: number;
  type: number;
  values: readonly number[];
}

const rationalBytes = (values: readonly number[]): Buffer => {
  const out = Buffer.alloc(values.length * 8);
  for (let i = 0; i < values.length; i += 2) {
    out.writeUInt32BE(values[i], i * 4);
    out.writeUInt32BE(values[i + 1], i * 4 + 4);
  }
  return out;
};

const writeIfd = (entries: readonly Entry[], ifdOffset: number): { table: Buffer; overflow: Buffer } => {
  const table = Buffer.alloc(2 + entries.length * 12 + 4);
  table.writeUInt16BE(entries.length, 0);
  const overflowParts: Buffer[] = [];
  let overflowAt = ifdOffset + table.length;

  entries.forEach((entry, index) => {
    const at = 2 + index * 12;
    table.writeUInt16BE(entry.tag, at);
    table.writeUInt16BE(entry.type, at + 2);

    if (entry.type === RATIONAL) {
      const count = entry.values.length / 2;
      table.writeUInt32BE(count, at + 4);
      table.writeUInt32BE(overflowAt, at + 8);
      const bytes = rationalBytes(entry.values);
      overflowParts.push(bytes);
      overflowAt += bytes.length;
      return;
    }

    if (entry.type === BYTE || entry.type === ASCII) {
      table.writeUInt32BE(entry.values.length, at + 4);
      for (let i = 0; i < entry.values.length && i < 4; i += 1) table.writeUInt8(entry.values[i], at + 8 + i);
      return;
    }

    table.writeUInt32BE(1, at + 4);
    table.writeUInt32BE(entry.values[0], at + 8);
  });

  return { table, overflow: Buffer.concat(overflowParts) };
};

export interface GpsPosition {
  latitudeDegrees: readonly [number, number, number];
  latitudeRef: 'N' | 'S';
  longitudeDegrees: readonly [number, number, number];
  longitudeRef: 'E' | 'W';
}

/**
 * Builds an APP1 EXIF segment holding a GPS IFD, so a generated original can carry
 * the location data a buyer copy must not.
 */
export const buildExifApp1 = (gps: GpsPosition): Buffer => {
  const header = Buffer.alloc(8);
  header.write('MM', 0, 'latin1');
  header.writeUInt16BE(42, 2);
  header.writeUInt32BE(8, 4);

  const ifd0Offset = 8;
  const ifd0Placeholder = writeIfd([{ tag: GPS_IFD_POINTER, type: LONG, values: [0] }], ifd0Offset);
  const gpsOffset = ifd0Offset + ifd0Placeholder.table.length + ifd0Placeholder.overflow.length;

  const ifd0 = writeIfd([{ tag: GPS_IFD_POINTER, type: LONG, values: [gpsOffset] }], ifd0Offset);

  const toRational = (parts: readonly [number, number, number]): number[] => [
    Math.round(parts[0]),
    1,
    Math.round(parts[1]),
    1,
    Math.round(parts[2] * 100),
    100,
  ];

  const gpsIfd = writeIfd(
    [
      { tag: 0x0000, type: BYTE, values: [2, 3, 0, 0] },
      { tag: 0x0001, type: ASCII, values: [gps.latitudeRef.charCodeAt(0), 0] },
      { tag: 0x0002, type: RATIONAL, values: toRational(gps.latitudeDegrees) },
      { tag: 0x0003, type: ASCII, values: [gps.longitudeRef.charCodeAt(0), 0] },
      { tag: 0x0004, type: RATIONAL, values: toRational(gps.longitudeDegrees) },
    ],
    gpsOffset,
  );

  const tiff = Buffer.concat([header, ifd0.table, ifd0.overflow, gpsIfd.table, gpsIfd.overflow]);
  const payload = Buffer.concat([Buffer.from('Exif\u0000\u0000', 'latin1'), tiff]);
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([segment, payload]);
};

/** Splices an APP1 segment straight after the JPEG start-of-image marker. */
export const withApp1 = (jpeg: Buffer, app1: Buffer): Buffer =>
  Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
