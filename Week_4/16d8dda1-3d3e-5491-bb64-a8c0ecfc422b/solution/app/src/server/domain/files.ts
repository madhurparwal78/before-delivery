// What a lesson file is: its kind is judged by its first bytes, never by its name or declared type.
type FileKind = 'slide' | 'model';

export interface Detected {
  kind: FileKind;
  contentType: string;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectFile(data: Buffer): Detected | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG)) return { kind: 'slide', contentType: 'image/png' };
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { kind: 'slide', contentType: 'image/jpeg' };
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'glTF' && data.readUInt32LE(4) === 2) {
    return { kind: 'model', contentType: 'model/gltf-binary' };
  }
  return null;
}
