// File kinds are judged by content, never by name or declared type (DP-15).

export type FileKind = 'slide' | 'model'

export function detectKind(bytes: Buffer): FileKind | null {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'slide'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'slide'
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'glTF' &&
    bytes.readUInt32LE(4) === 2
  ) {
    return 'model'
  }
  return null
}

export function contentTypeFor(kind: FileKind, bytes?: Buffer): string {
  if (kind === 'slide' && bytes) {
    return bytes.readUInt32BE(0) === 0x89504e47 ? 'image/png' : 'image/jpeg'
  }
  return 'model/gltf-binary'
}
