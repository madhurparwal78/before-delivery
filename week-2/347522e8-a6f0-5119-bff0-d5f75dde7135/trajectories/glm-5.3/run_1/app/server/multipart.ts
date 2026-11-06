import * as crypto from "node:crypto";
import { ApiError } from "./errors.js";

export type UploadPart = {
  name: string;
  value: string | null;
  filename: string | null;
  contentType: string | null;
  data: Buffer;
};

// Small multipart parser: enough for one upload with a few fields plus a file.
export const parseMultipart = (body: Buffer, boundary: string): UploadPart[] => {
  const parts: UploadPart[] = [];
  const delimiter = Buffer.from(`--${boundary}`);
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    if (body.slice(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const part = body.slice(start, next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      index = next;
      continue;
    }
    const headerText = part.slice(0, headerEnd).toString("utf8");
    const data = part.slice(headerEnd + 4, part.length - 2);
    const nameMatch = /name="([^"]*)"/.exec(headerText);
    const fileMatch = /filename="([^"]*)"/.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    parts.push({
      name: nameMatch ? nameMatch[1]! : "",
      value: fileMatch ? null : data.toString("utf8"),
      filename: fileMatch ? fileMatch[1]! : null,
      contentType: typeMatch ? typeMatch[1]!.trim() : null,
      data,
    });
    index = next;
  }
  return parts;
};

export const boundaryOf = (contentType: string | undefined): string | null => {
  if (!contentType) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  return (match[1] ?? match[2] ?? "").trim();
};

export const bodyHash = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex");
