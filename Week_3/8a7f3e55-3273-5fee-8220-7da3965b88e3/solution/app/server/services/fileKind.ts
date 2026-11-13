import { TEXT_LIMITS } from "../../shared/text.js";

export const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

const [PDF, PNG, JPEG, DOCX, PPTX] = ACCEPTED_TYPES;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;

/** Entry names of a ZIP archive read from its central directory, or null when the bytes are not a well-formed ZIP. */
function zipEntryNames(data: Buffer): string[] | null {
  const earliest = Math.max(0, data.length - 22 - 0xffff);
  let end = -1;
  for (let at = data.length - 22; at >= earliest; at -= 1) {
    if (data.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end === -1) return null;
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== CENTRAL_FILE_HEADER) return null;
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    if (at + 46 + nameLength > data.length) return null;
    names.push(data.subarray(at + 46, at + 46 + nameLength).toString("utf8"));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

const isUnsafeEntry = (name: string): boolean =>
  name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes("..");

/** The accepted kind of a file judged by its bytes alone; null when it is not an accepted kind. */
export function detectKind(data: Buffer): (typeof ACCEPTED_TYPES)[number] | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return PDF;
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return PNG;
  if (data[0] === 0xff && data[1] === 0xd8) return JPEG;
  const names = zipEntryNames(data);
  if (names === null || names.some(isUnsafeEntry)) return null;
  if (names.includes("word/document.xml")) return DOCX;
  if (names.includes("ppt/presentation.xml")) return PPTX;
  return null;
}

/** The display name of an upload: directory part and control characters removed, at most 120 characters. */
export function displayName(uploaded: string): string {
  const base = uploaded.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "");
  const cut = [...cleaned].slice(0, TEXT_LIMITS.display_name).join("");
  return cut === "" ? "file" : cut;
}

const PERCENT_ENCODING_KEEPS = /[A-Za-z0-9!#$&+\-.^_`|~]/;

/** The `Content-Disposition` of a download: an ASCII fallback plus the RFC 5987 form of the display name. */
export function attachmentDisposition(name: string): string {
  const fallback = [...name].map((char) => (/^[\u0020-\u007e]$/.test(char) && char !== '"' && char !== "\\" ? char : "_")).join("");
  const encoded = [...Buffer.from(name, "utf8")]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return byte < 0x80 && PERCENT_ENCODING_KEEPS.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
