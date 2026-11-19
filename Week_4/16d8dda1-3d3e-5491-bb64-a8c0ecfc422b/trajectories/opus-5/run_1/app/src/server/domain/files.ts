import { ApiError } from '../http.js';
import { config } from '../config.js';

export type FileKind = 'slide' | 'model';

export interface UploadPart {
  name: string;
  bytes: Buffer;
}

export interface JudgedFile {
  name: string;
  kind: FileKind;
  contentType: string;
  bytes: Buffer;
}

const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);

/** DP-15: a file's kind comes from its first bytes, never its name or declared type. */
export function detectKind(bytes: Buffer): { kind: FileKind; contentType: string } | null {
  if (bytes.byteLength >= pngMagic.byteLength && bytes.subarray(0, pngMagic.byteLength).equals(pngMagic)) {
    return { kind: 'slide', contentType: 'image/png' };
  }
  if (bytes.byteLength >= jpegMagic.byteLength && bytes.subarray(0, jpegMagic.byteLength).equals(jpegMagic)) {
    return { kind: 'slide', contentType: 'image/jpeg' };
  }
  if (bytes.byteLength >= 12 && bytes.subarray(0, 4).toString('latin1') === 'glTF' && bytes.readUInt32LE(4) === 2) {
    return { kind: 'model', contentType: 'model/gltf-binary' };
  }
  return null;
}

export function judgeUpload(parts: UploadPart[], existingSlides: number): JudgedFile[] {
  if (parts.length === 0) throw new ApiError(422, 'Choose at least one file.');
  const judged: JudgedFile[] = [];
  let slides = existingSlides;
  for (const part of parts) {
    const detected = detectKind(part.bytes);
    if (detected === null) {
      throw new ApiError(422, `${part.name} isn't a PNG, JPEG or glTF binary.`);
    }
    const limit = detected.kind === 'slide' ? config.slideMaxBytes : config.modelMaxBytes;
    if (part.bytes.byteLength > limit) {
      throw new ApiError(413, `${part.name} is larger than the limit.`);
    }
    if (detected.kind === 'slide') {
      slides += 1;
      if (slides > config.slidesMaxPerLesson) {
        throw new ApiError(422, `A lesson holds at most ${config.slidesMaxPerLesson} slides.`);
      }
    }
    judged.push({ name: part.name, kind: detected.kind, contentType: detected.contentType, bytes: part.bytes });
  }
  return judged;
}
