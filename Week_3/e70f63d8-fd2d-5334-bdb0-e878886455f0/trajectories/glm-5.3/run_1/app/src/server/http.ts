import { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { copy } from "./copy.js";
import { now } from "./clock.js";

// One error shape, one precedence order, no 403 anywhere.

export interface ApiError {
  status: number;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
}

export const err = (status: number, code: string, message: string, extra?: Record<string, unknown>): ApiError => ({
  status,
  code,
  message,
  extra,
});

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  rawBody: Buffer;
  cookies: Record<string, string>;
  session: SessionUser | null;
  sessionToken: string | null;
  params: Record<string, string>;
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;

export interface Route {
  method: string;
  path: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const compile = (path: string): { pattern: RegExp; keys: string[] } => {
  const keys: string[] = [];
  const source = path
    .split("/")
    .map((part) => {
      if (part.startsWith(":")) {
        keys.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { pattern: new RegExp(`^${source}$`), keys };
};

export const route = (method: string, path: string, handler: Handler): Route => {
  const { pattern, keys } = compile(path);
  return { method, path, pattern, keys, handler };
};

export const readCookies = (req: IncomingMessage): Record<string, string> => {
  const header = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
};

export const setSessionCookie = (res: ServerResponse, token: string): void => {
  res.setHeader(
    "Set-Cookie",
    `oc_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`,
  );
};

export const clearSessionCookie = (res: ServerResponse): void => {
  res.setHeader("Set-Cookie", "oc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
};

export const sendJson = (res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void => {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    ...extraHeaders,
  });
  res.end(payload);
};

export const sendError = (res: ServerResponse, e: ApiError): void => {
  const body: { error: { code: string; message: string } & Record<string, unknown> } = {
    error: { code: e.code, message: e.message },
  };
  if (e.extra) Object.assign(body.error, e.extra);
  sendJson(res, e.status, body);
};

// Body reading with the published size limits. A larger body is answered 413.
export const readBody = (req: IncomingMessage, limit: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(err(413, "PAYLOAD_TOO_LARGE", copy.unexpected));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on("error", () => {
      if (!tooLarge) reject(err(400, "BAD_JSON", copy.unexpected));
    });
  });

export const parseJsonBody = (raw: Buffer): unknown => {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw err(400, "BAD_JSON", copy.unexpected);
  }
};

export const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const asBool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

export const sameOrigin = (req: IncomingMessage): boolean => {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  if (typeof host !== "string") return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
};

export const isDateString = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

// `<date>` in the published format: D Mon YYYY.
export const playedOnOf = (iso: string): string => {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.appTz,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
  const [day, month, year] = parts.replace(/,/g, "").split(" ");
  return `${day} ${month} ${year}`;
};

// A yyyy-mm-dd date in the app's time zone.
export const todayInTz = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: config.appTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now());
