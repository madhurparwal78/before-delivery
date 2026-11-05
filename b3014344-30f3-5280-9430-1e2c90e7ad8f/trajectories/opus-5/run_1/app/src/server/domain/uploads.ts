import { MAX_FILE_BYTES } from "../config.js";
import { COPY } from "../../shared/copy.js";
import { errors } from "../errors.js";

interface DetectedType {
  contentType: string;
  extensions: string[];
}

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

function startsWith(bytes: Buffer, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function looksLikeSvg(bytes: Buffer): boolean {
  const head = TEXT_DECODER.decode(bytes.subarray(0, Math.min(bytes.length, 2048))).trimStart();
  return head.startsWith("<?xml") || head.startsWith("<!--") || head.startsWith("<svg") || head.startsWith("<!DOCTYPE");
}

function safeSvg(bytes: Buffer): boolean {
  const text = TEXT_DECODER.decode(bytes).toLowerCase();
  const rootMatch = /<\s*([a-z0-9:]+)[\s>]/.exec(text.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!doctype[\s\S]*?>/g, ""));
  const root = rootMatch?.[1] ?? "";
  if (root !== "svg" && root !== "svg:svg") return false;
  if (/<\s*script/.test(text)) return false;
  if (/<\s*foreignobject/.test(text)) return false;
  if (/\son[a-z]+\s*=/.test(text)) return false;
  if (/javascript:/.test(text)) return false;
  return true;
}

/** The one place an upload's type is detected, from the file's own bytes. */
function detectType(bytes: Buffer): DetectedType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png", extensions: ["png"] };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { contentType: "image/jpeg", extensions: ["jpg", "jpeg"] };
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { contentType: "image/webp", extensions: ["webp"] };
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { contentType: "application/pdf", extensions: ["pdf"] };
  }
  if (startsWith(bytes, [0x77, 0x4f, 0x46, 0x32])) {
    return { contentType: "font/woff2", extensions: ["woff2"] };
  }
  if (startsWith(bytes, [0x4f, 0x54, 0x54, 0x4f])) {
    return { contentType: "font/otf", extensions: ["otf"] };
  }
  if (startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) || startsWith(bytes, [0x74, 0x72, 0x75, 0x65])) {
    return { contentType: "font/ttf", extensions: ["ttf"] };
  }
  if (looksLikeSvg(bytes) && safeSvg(bytes)) {
    return { contentType: "image/svg+xml", extensions: ["svg"] };
  }
  return null;
}

function nameAllowed(name: string): boolean {
  if (name.length < 1 || name.length > 120) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (name.startsWith(".")) return false;
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export interface AcceptedUpload {
  name: string;
  contentType: string;
  bytes: Buffer;
}

/** Applies the published allowlist: size, then name, then the detected content type. */
export function checkUpload(name: string, bytes: Buffer): AcceptedUpload {
  if (bytes.length > MAX_FILE_BYTES) throw errors.fileTooLarge();
  if (!nameAllowed(name)) {
    throw errors.validation({ file: COPY.uploadNameRefused });
  }
  const detected = detectType(bytes);
  if (!detected) throw errors.unsupportedFileType(name);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!detected.extensions.includes(extension)) throw errors.unsupportedFileType(name);
  return { name, contentType: detected.contentType, bytes };
}
