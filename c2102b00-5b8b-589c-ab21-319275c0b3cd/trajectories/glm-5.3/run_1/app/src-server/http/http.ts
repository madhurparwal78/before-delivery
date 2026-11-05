import { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, errors } from "../errors";
import { one } from "../db";

export type Role = "coordinator" | "member" | "volunteer";

export interface Viewer {
  role: Role;
  name: string;
  householdCode: string | null;
}

export const MAX_JSON_BYTES = 16384;
export const MAX_UPLOAD_BYTES = 10000000;

export class BodyTooLarge extends Error {}
export class WrongContentType extends Error {}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function viewerOf(req: IncomingMessage): Viewer | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["tally_session"];
  if (!token) return null;
  const row = one<{ role: Role; person_name: string; household_code: string | null }>(
    "SELECT role, person_name, household_code FROM sessions WHERE token = ?",
    token
  );
  if (!row) return null;
  return { role: row.role, name: row.person_name, householdCode: row.household_code };
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (ct !== "application/json") throw errors.unsupportedMediaType();
  const raw = await readBody(req, MAX_JSON_BYTES);
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw errors.validation({ body: "Send a JSON object." });
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw errors.validation({ body: "Send valid JSON." });
  }
}

export function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return readBody(req, MAX_UPLOAD_BYTES);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = req.headers["content-length"];
    if (declared !== undefined && parseInt(declared, 10) > limit) {
      reject(errors.tooLarge());
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(errors.tooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (e) => reject(new ApiError(400, "bad_request", e.message)));
  });
}

/** Cross-origin state-changing requests are refused. */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const o = new URL(origin);
    const host = req.headers.host;
    return host !== undefined && o.host === host;
  } catch {
    return false;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: ApiError): void {
  sendJson(res, err.status, JSON.parse(err.body()), err.headers);
}

export function etagOf(revision: number): string {
  return `"r${revision}"`;
}

export function parseIfMatch(value: string | undefined): { revision: number | null } {
  if (value === undefined) return { revision: null };
  const m = /^"?r(\d+)"?$/.exec(value.trim());
  if (!m) return { revision: -1 };
  return { revision: parseInt(m[1], 10) };
}
