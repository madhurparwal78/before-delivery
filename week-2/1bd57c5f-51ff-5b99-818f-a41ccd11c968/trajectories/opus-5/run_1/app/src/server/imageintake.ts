import { IMAGE_BYTE_LIMIT } from './env.js';
import { fail } from './errors.js';
import type { MultipartPart } from './http.js';
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_EXTENSIONS,
  sniffImage,
  stripMetadata,
  type ImageKind,
} from './services/images.js';

export type IntakeImage = {
  kind: ImageKind;
  contentType: string;
  extension: string;
  data: Buffer;
  bytes: number;
};

/** The single image gate: size, then content-sniffed type, then metadata removal. */
export function intakeImage(part: MultipartPart): IntakeImage {
  if (part.data.length > IMAGE_BYTE_LIMIT) fail('photo_too_large');
  const kind = sniffImage(part.data);
  if (kind === null) fail('unsupported_image');
  const data = stripMetadata(part.data, kind);
  return {
    kind,
    contentType: IMAGE_CONTENT_TYPES[kind],
    extension: IMAGE_EXTENSIONS[kind],
    data,
    bytes: data.length,
  };
}
