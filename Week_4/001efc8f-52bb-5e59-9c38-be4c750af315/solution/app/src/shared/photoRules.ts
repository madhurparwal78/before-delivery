// Photo acceptance rules shared by the browser's quick checks and the server's full checks
// (brief: Photos (rules)). The browser applies only the signature, size and count; the server
// adds the declared-pixel and decode checks, in this order.

export const PHOTO_BYTES_LIMIT = 10_000_000;
export const PHOTO_PIXEL_LIMIT = 40_000_000;
export const PHOTO_COUNT_LIMIT = 4;

type PhotoType = "jpeg" | "png" | "webp";

// The format named by the leading bytes, or null when they carry no JPEG, PNG or WebP signature.
export function photoSignature(head: Uint8Array): PhotoType | null {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  if (at(0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "webp";
  return null;
}

export const PHOTO_COPY = {
  wrongType: (name: string) => `${name} is not a JPEG, PNG or WebP photo.`,
  tooLarge: (name: string) => `${name} is over the photo size limit.`,
  tooManyPixels: (name: string) => `${name} is over the 40-megapixel limit.`,
  tooMany: "That is more photos than one message can carry.",
} as const;
