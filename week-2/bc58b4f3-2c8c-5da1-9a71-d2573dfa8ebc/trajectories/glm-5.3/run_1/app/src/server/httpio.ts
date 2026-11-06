import { IncomingMessage, ServerResponse } from "node:http";

export const JSON_BODY_LIMIT = 65_536;
export const MULTIPART_BODY_LIMIT = 5_100_000;
export const FORM_FILE_LIMIT = 5_000_000;

export interface ParsedBody {
  raw: Buffer;
  json: unknown | undefined;
  multipart: ParsedMultipart | undefined;
}

export interface ParsedPart {
  name: string;
  filename: string | null;
  contentType: string;
  data: Buffer;
}

export interface ParsedMultipart {
  fields: Map<string, string>;
  files: Map<string, ParsedPart>;
}

export function isStateChanging(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE" || method === "PUT";
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw Object.assign(new Error("payload_too_large"), { code: "payload_too_large" });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function parseMultipart(body: Buffer, contentType: string): ParsedMultipart {
  const match = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!match) return { fields: new Map(), files: new Map() };
  const boundary = Buffer.from("--" + match[1]);
  const fields = new Map<string, string>();
  const files = new Map<string, ParsedPart>();
  let idx = body.indexOf(boundary);
  while (idx !== -1) {
    const start = idx + boundary.length;
    if (body.slice(start, start + 2).toString() === "--") break;
    const headStart = start + 2;
    const headEnd = body.indexOf(Buffer.from("\r\n\r\n"), headStart);
    if (headEnd === -1) break;
    const headers = body.slice(headStart, headEnd).toString("utf8");
    const nameMatch = /name="([^"]*)"/.exec(headers);
    const fileMatch = /filename="([^"]*)"/.exec(headers);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
    const dataStart = headEnd + 4;
    const next = body.indexOf(boundary, dataStart);
    if (next === -1) break;
    let dataEnd = next - 2; // trailing \r\n before boundary
    if (dataEnd < dataStart) dataEnd = dataStart;
    const data = body.slice(dataStart, dataEnd);
    if (nameMatch) {
      const name = nameMatch[1];
      if (fileMatch) {
        files.set(name, {
          name,
          filename: fileMatch[1],
          contentType: (typeMatch?.[1] ?? "application/octet-stream").trim(),
          data,
        });
      } else {
        fields.set(name, data.toString("utf8"));
      }
    }
    idx = next;
  }
  return { fields, files };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}
