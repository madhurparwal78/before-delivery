import type { IncomingMessage } from "node:http";
import { UPLOAD_LIMIT_BYTES } from "../shared/schemas.js";
import { readBody } from "./body.js";

const BOUNDARY = /boundary=(?:"([^"]+)"|([^;\s]+))/i;
const FIELD_NAME = /\bname="([^"]*)"/i;

// The bytes of the `image` field of a multipart/form-data request, or null when the request carries none.
export async function readImageField(req: IncomingMessage): Promise<Buffer | null> {
  const body = await readBody(req, UPLOAD_LIMIT_BYTES);
  const match = BOUNDARY.exec(req.headers["content-type"] ?? "");
  if (!match || !(req.headers["content-type"] ?? "").toLowerCase().startsWith("multipart/form-data")) return null;
  const delimiter = Buffer.from(`--${match[1] ?? match[2]}`);
  const separator = Buffer.concat([Buffer.from("\r\n"), delimiter]);
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString("latin1") === "--") return null;
    const headerEnd = body.indexOf("\r\n\r\n", start);
    const end = headerEnd === -1 ? -1 : body.indexOf(separator, headerEnd + 4);
    if (end === -1) return null;
    const headers = body.subarray(start, headerEnd).toString("latin1");
    if (FIELD_NAME.exec(headers)?.[1] === "image") return body.subarray(headerEnd + 4, end);
    at = end + 2;
  }
  return null;
}
