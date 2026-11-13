interface Detected {
  contentType: string;
}

const startsWith = (bytes: Buffer, signature: number[], offset = 0): boolean => signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

const MARKUP = /^\s*(<\?xml|<!doctype|<svg|<html)/i;

/** The type of an upload, judged by its leading bytes and never by its name. */
export function detect(bytes: Buffer): Detected | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: "image/png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg" };
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return { contentType: "image/gif" };
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return { contentType: "image/webp" };
  if (startsWith(bytes, ascii("%PDF-"))) return { contentType: "application/pdf" };
  if (bytes.includes(0)) return null;
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return MARKUP.test(content) ? null : { contentType: "text/plain" };
  } catch {
    return null;
  }
}

/** The part of the given name after any slash, without control characters, at most 120 characters. */
export function storedName(given: string): string {
  const last = given.split(/[\\/]/).pop() ?? "";
  const clean = Array.from(last.replace(/\p{Cc}/gu, "")).slice(0, 120).join("");
  return clean || "file";
}

export function contentDisposition(inline: boolean, name: string): string {
  const quoted = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = /[^\x20-\x7e]/.test(name) ? `; filename*=UTF-8''${encodeURIComponent(name)}` : "";
  return `${inline ? "inline" : "attachment"}; filename="${quoted}"${encoded}`;
}
