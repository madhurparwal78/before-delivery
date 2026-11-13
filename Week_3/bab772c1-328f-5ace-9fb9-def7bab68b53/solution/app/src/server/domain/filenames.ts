/** Capture names: percent-encoded UTF-8 in, NFC-normalised storage, RFC 6266 downloads. */

import { hasForbiddenCharacters } from "../../shared/text.js";

const RAW_PATTERN = /^[\x21-\x7e]+$/;

/** Decodes `X-Capture-Filename`, or null when it breaks the published rule. */
export function decodeCaptureFilename(raw: string): string | null {
  if (!RAW_PATTERN.test(raw)) {
    return null;
  }
  let octets: Buffer;
  try {
    octets = percentDecode(raw);
  } catch {
    return null;
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(octets);
  } catch {
    return null;
  }
  const normalised = decoded.normalize("NFC");
  const length = [...normalised].length;
  if (length < 1 || length > 120) {
    return null;
  }
  if (hasForbiddenCharacters(normalised) || /[/\\]/.test(normalised)) {
    return null;
  }
  return normalised;
}

function percentDecode(raw: string): Buffer {
  const bytes: number[] = [];
  for (let at = 0; at < raw.length; at += 1) {
    const character = raw[at];
    if (character !== "%") {
      bytes.push(raw.charCodeAt(at));
      continue;
    }
    const triplet = raw.slice(at + 1, at + 3);
    if (!/^[0-9a-fA-F]{2}$/.test(triplet)) {
      throw new Error("invalid percent triplet");
    }
    bytes.push(Number.parseInt(triplet, 16));
    at += 2;
  }
  return Buffer.from(bytes);
}

function isPrintableAscii(text: string): boolean {
  return [...text].every((character) => {
    const code = character.codePointAt(0) as number;
    return code >= 0x20 && code <= 0x7e;
  });
}

/** `attachment` with an RFC 6266 fallback and an RFC 8187 `filename*` when needed. */
export function contentDisposition(name: string): string {
  const fallback = [...name]
    .map((character) => {
      const code = character.codePointAt(0) as number;
      const printable = code >= 0x20 && code <= 0x7e;
      return printable && !['"', "\\", "%"].includes(character) ? character : "_";
    })
    .join("");
  const base = `attachment; filename="${fallback}"`;
  if (isPrintableAscii(name)) {
    return base;
  }
  const encoded = [...Buffer.from(name, "utf8")]
    .map((byte) =>
      /[A-Za-z0-9!#$&+\-.^_`|~]/.test(String.fromCharCode(byte))
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .join("");
  return `${base}; filename*=UTF-8''${encoded}`;
}
