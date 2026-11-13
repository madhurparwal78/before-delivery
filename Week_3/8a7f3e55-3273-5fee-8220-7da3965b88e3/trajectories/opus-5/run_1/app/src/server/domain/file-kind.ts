const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;

export type FileKind =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function zipEntryNames(bytes: Buffer): string[] | null {
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return null;
  let entryCount = bytes.readUInt16LE(eocd + 10);
  let directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || bytes.readUInt32LE(locator) !== ZIP64_LOCATOR_SIGNATURE) return null;
    const zip64Eocd = Number(bytes.readBigUInt64LE(locator + 8));
    if (zip64Eocd < 0 || zip64Eocd + 56 > bytes.length) return null;
    if (bytes.readUInt32LE(zip64Eocd) !== ZIP64_EOCD_SIGNATURE) return null;
    entryCount = Number(bytes.readBigUInt64LE(zip64Eocd + 32));
    directoryOffset = Number(bytes.readBigUInt64LE(zip64Eocd + 48));
  }
  const names: string[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length) return null;
    if (bytes.readUInt32LE(cursor) !== CENTRAL_ENTRY_SIGNATURE) return null;
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    if (nameStart + nameLength > bytes.length) return null;
    names.push(bytes.subarray(nameStart, nameStart + nameLength).toString('utf8'));
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  return names;
}

function hasUnsafeEntry(names: readonly string[]): boolean {
  return names.some((name) => {
    if (name.startsWith('/') || name.startsWith('\\')) return true;
    if (/^[A-Za-z]:/.test(name)) return true;
    return name.split(/[/\\]/u).includes('..');
  });
}

/** The accepted kind is decided from the bytes alone; names and declared types play no part. */
export function detectFileKind(bytes: Buffer): FileKind | null {
  if (bytes.length === 0) return null;
  if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'latin1'))) return 'application/pdf';
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) {
    const names = zipEntryNames(bytes);
    if (!names || hasUnsafeEntry(names)) return null;
    if (names.includes('word/document.xml')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (names.includes('ppt/presentation.xml')) {
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    }
  }
  return null;
}
