// The photograph rules (brief: Intake photographs), judged by content and header only.
// The browser runs them when a file is dropped; the server runs them again on every upload.

import { F, photoBytes, photoEdge, photoPixels } from "./feedback.js";

interface PhotoLimits {
  FLAN_UPLOAD_MAX_BYTES: number;
  FLAN_PHOTO_MIN_EDGE_PX: number;
  FLAN_PHOTO_MAX_EDGE_PX: number;
  FLAN_PHOTO_MAX_PIXELS: number;
}

type PhotoKind = "png" | "jpeg" | "webp";

export type PhotoVerdict =
  | { ok: true; kind: PhotoKind; contentType: string; width: number; height: number }
  | { ok: false; copy: string; oversized: boolean };

const CONTENT_TYPES: Record<PhotoKind, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
}
function u24le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
}
function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to));
}

function signature(b: Uint8Array): PhotoKind | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  return null;
}

function looksLikeMarkup(b: Uint8Array): boolean {
  const head = ascii(b, 0, Math.min(b.length, 1024)).replace(/^﻿/, "").trimStart().toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!doctype svg") || /<svg[\s>]/.test(head);
}

/** Width and height read from the file header, without decoding any pixels. */
function dimensions(kind: PhotoKind, b: Uint8Array): { width: number; height: number } | null {
  if (kind === "png") {
    return b.length >= 24 && ascii(b, 12, 16) === "IHDR" ? { width: u32be(b, 16), height: u32be(b, 20) } : null;
  }
  if (kind === "jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
      i += 2 + u16be(b, i + 2);
    }
    return null;
  }
  const chunk = ascii(b, 12, 16);
  if (chunk === "VP8 " && b.length >= 30) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === "VP8L" && b.length >= 25) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X" && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

function u16le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}

export function judgePhoto(bytes: Uint8Array, limits: PhotoLimits): PhotoVerdict {
  if (bytes.length > limits.FLAN_UPLOAD_MAX_BYTES) {
    return { ok: false, copy: photoBytes(limits.FLAN_UPLOAD_MAX_BYTES), oversized: true };
  }
  if (looksLikeMarkup(bytes)) return { ok: false, copy: F.PHOTO_SVG, oversized: false };
  const kind = signature(bytes);
  const size = kind ? dimensions(kind, bytes) : null;
  if (!kind || !size || size.width < 1 || size.height < 1) return { ok: false, copy: F.PHOTO_TYPE, oversized: false };
  const edge = Math.max(size.width, size.height);
  if (edge < limits.FLAN_PHOTO_MIN_EDGE_PX || edge > limits.FLAN_PHOTO_MAX_EDGE_PX) {
    return { ok: false, copy: photoEdge(limits.FLAN_PHOTO_MIN_EDGE_PX, limits.FLAN_PHOTO_MAX_EDGE_PX), oversized: false };
  }
  if (size.width * size.height > limits.FLAN_PHOTO_MAX_PIXELS) {
    return { ok: false, copy: photoPixels(limits.FLAN_PHOTO_MAX_PIXELS), oversized: false };
  }
  return { ok: true, kind, contentType: CONTENT_TYPES[kind], ...size };
}

export const PHOTO_EXTENSIONS: Record<PhotoKind, string> = { png: "png", jpeg: "jpg", webp: "webp" };
