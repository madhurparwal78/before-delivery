// Uploads: multipart parsing and the file type decided from the bytes and the declared type together.
import { ApiError } from "./errors.js";

export interface Part {
  name: string;
  filename: string | null;
  contentType: string;
  data: Buffer;
}

export function parseMultipart(body: Buffer, contentType: string): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) return [];
  const delimiter = Buffer.from(`--${marker}`);
  const parts: Part[] = [];
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const chunk = body.subarray(start + 2, next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = chunk.subarray(0, split).toString("utf8");
      const disposition = /content-disposition:[^\r\n]*/i.exec(head)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? "";
      const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
      const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim().toLowerCase() ?? "";
      parts.push({ name, filename, contentType: type, data: Buffer.from(chunk.subarray(split + 4)) });
    }
    cursor = next;
  }
  return parts;
}

type FileKind = "pdf" | "docx" | "pptx" | "text" | "png" | "jpeg";

const MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  text: "text/plain",
  png: "image/png",
  jpeg: "image/jpeg",
};

const EXTENSIONS: Record<FileKind, readonly string[]> = {
  pdf: [".pdf"],
  docx: [".docx"],
  pptx: [".pptx"],
  text: [".txt", ".text"],
  png: [".png"],
  jpeg: [".jpg", ".jpeg"],
};

function sniff(data: Buffer, filename: string): FileKind[] {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return ["pdf"];
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ["png"];
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return ["jpeg"];
  if (data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const names = data.toString("latin1");
    if (names.includes("word/")) return ["docx"];
    if (names.includes("ppt/")) return ["pptx"];
    return filename.toLowerCase().endsWith(".pptx") ? ["pptx"] : ["docx"];
  }
  const text = data.toString("utf8");
  if (data.length > 0 && !text.includes("\u0000") && !text.includes("�")) return ["text"];
  return [];
}

/** The canonical MIME type of an upload, or `unsupported_media_type`. */
export function acceptedType(part: Part, allowed: readonly FileKind[]): string {
  const filename = (part.filename ?? "").toLowerCase();
  const declared = part.contentType;
  for (const kind of sniff(part.data, filename)) {
    if (!allowed.includes(kind)) continue;
    const declaredMatches =
      declared === MIME[kind] ||
      ((declared === "" || declared === "application/octet-stream") && EXTENSIONS[kind].some((ext) => filename.endsWith(ext)));
    if (declaredMatches) return MIME[kind];
  }
  throw new ApiError("unsupported_media_type");
}

/** A safe original filename: no directories, no control characters. */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned || "file";
}
