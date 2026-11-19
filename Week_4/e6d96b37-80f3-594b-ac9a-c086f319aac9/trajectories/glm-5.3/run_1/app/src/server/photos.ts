import type { FlanEnv } from "../shared/env.js";
import { copyFor, type FeedbackKey } from "../shared/feedback.js";

export interface PhotoDimensions {
  width: number;
  height: number;
}

export interface PhotoCheck {
  ok: boolean;
  kind: "jpeg" | "png" | "webp";
  contentType: string;
  width: number;
  height: number;
  error?: { key: FeedbackKey; max?: number; min?: number };
}

/** Inspect an uploaded photo by signature. Dimensions come from headers, never by decoding. */
export function checkPhoto(env: FlanEnv, bytes: Uint8Array): PhotoCheck {
  const kind = detectKind(bytes);
  if (kind === "svg") {
    return fail("F_PHOTO_SVG", env);
  }
  if (kind === null) {
    return fail("F_PHOTO_TYPE", env);
  }
  const dims = readDimensions(kind, bytes);
  if (dims === null) {
    return fail("F_PHOTO_TYPE", env);
  }
  const longEdge = Math.max(dims.width, dims.height);
  if (longEdge < env.FLAN_PHOTO_MIN_EDGE_PX || longEdge > env.FLAN_PHOTO_MAX_EDGE_PX) {
    return {
      ok: false,
      kind,
      contentType: contentTypeFor(kind),
      width: dims.width,
      height: dims.height,
      error: { key: "F_PHOTO_EDGE", min: env.FLAN_PHOTO_MIN_EDGE_PX, max: env.FLAN_PHOTO_MAX_EDGE_PX },
    };
  }
  if (dims.width * dims.height > env.FLAN_PHOTO_MAX_PIXELS) {
    return {
      ok: false,
      kind,
      contentType: contentTypeFor(kind),
      width: dims.width,
      height: dims.height,
      error: { key: "F_PHOTO_PIXELS", max: env.FLAN_PHOTO_MAX_PIXELS },
    };
  }
  return {
    ok: true,
    kind,
    contentType: contentTypeFor(kind),
    width: dims.width,
    height: dims.height,
  };
}

export function checkPhotoSize(env: FlanEnv, size: number): { max: number } | null {
  if (size > env.FLAN_UPLOAD_MAX_BYTES) {
    return { max: env.FLAN_UPLOAD_MAX_BYTES };
  }
  return null;
}

function fail(key: FeedbackKey, env: FlanEnv): PhotoCheck {
  return { ok: false, kind: "png", contentType: "", width: 0, height: 0, error: { key, max: env.FLAN_UPLOAD_MAX_BYTES } };
}

export function contentTypeFor(kind: "jpeg" | "png" | "webp"): string {
  switch (kind) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
  }
}

export function extensionFor(kind: "jpeg" | "png" | "webp"): string {
  switch (kind) {
    case "jpeg":
      return "jpg";
    case "png":
      return "png";
    case "webp":
      return "webp";
  }
}

export type PhotoKind = "jpeg" | "png" | "webp" | "svg" | null;

/** Detect the true content kind from the file's signature. */
export function detectKind(bytes: Uint8Array): PhotoKind {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }
  // SVG or XML text of any shape is refused as a photograph.
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype svg")) {
    return "svg";
  }
  if (head.startsWith("<")) {
    return "svg";
  }
  return null;
}

/** Parse width/height from the header without decoding. */
export function readDimensions(kind: "jpeg" | "png" | "webp", bytes: Uint8Array): PhotoDimensions | null {
  if (kind === "png") {
    if (bytes.length < 24) return null;
    const width = be32(bytes, 16);
    const height = be32(bytes, 20);
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }
  if (kind === "webp") {
    if (bytes.length < 30) return null;
    const fourcc = new TextDecoder("latin1").decode(bytes.slice(12, 16));
    if (fourcc === "VP8 ") {
      if (bytes.length < 30) return null;
      const width = le16(bytes, 26) & 0x3fff;
      const height = le16(bytes, 28) & 0x3fff;
      return { width, height };
    }
    if (fourcc === "VP8L") {
      if (bytes.length < 25) return null;
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    if (fourcc === "VP8X") {
      if (bytes.length < 30) return null;
      const width = 1 + ((bytes[24]) | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + ((bytes[27]) | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    return null;
  }
  // JPEG: scan SOF markers.
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = be16(bytes, offset + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (offset + 9 > bytes.length) return null;
      const height = be16(bytes, offset + 5);
      const width = be16(bytes, offset + 7);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function be16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function le16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function be32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

export function photoErrorText(error: { key: FeedbackKey; max?: number; min?: number }): string {
  return copyFor(error.key, { max: error.max ?? "", min: error.min ?? "" });
}
