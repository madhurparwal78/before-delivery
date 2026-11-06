// The request pipeline: the brief's whole-API precedence is decided here, in order, before any handler runs:
// foreign origin → body size → content type → session. Handlers then check visibility, role,
// idempotency, state and validation in that order.
import type { IncomingMessage, ServerResponse } from "node:http";
import { type Session, findSession } from "./auth.js";

const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 5_100_000;
const FORM_LIMIT = 5_000_000;
type ErrorCode =
  | "cross_origin"
  | "payload_too_large"
  | "unsupported_media_type"
  | "unauthenticated"
  | "invalid_credentials"
  | "not_found"
  | "forbidden"
  | "idempotency_key_required"
  | "idempotency_conflict"
  | "invalid_transition"
  | "seat_taken"
  | "already_holding"
  | "calendar_conflict"
  | "late_change"
  | "already_verified"
  | "not_billable"
  | "duplicate_rate"
  | "email_taken"
  | "validation"
  | "storage_unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  cross_origin: 403,
  payload_too_large: 413,
  unsupported_media_type: 415,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  forbidden: 403,
  idempotency_key_required: 400,
  idempotency_conflict: 409,
  invalid_transition: 409,
  seat_taken: 409,
  already_holding: 409,
  calendar_conflict: 409,
  late_change: 409,
  already_verified: 409,
  not_billable: 409,
  duplicate_rate: 409,
  email_taken: 409,
  validation: 422,
  storage_unavailable: 503,
  internal: 500,
};

const MESSAGES: Record<ErrorCode, string> = {
  cross_origin: "Requests that change data must come from Teamseat itself.",
  payload_too_large: "The request body is too large.",
  unsupported_media_type: "Send this request as JSON.",
  unauthenticated: "Sign in to continue.",
  invalid_credentials: "Email or password is wrong.",
  not_found: "Not found.",
  forbidden: "Your role cannot do this.",
  idempotency_key_required: "Send an Idempotency-Key header of 1 to 100 printable characters.",
  idempotency_conflict: "This request was already submitted with different details.",
  invalid_transition: "This action is not possible in the request's current state.",
  seat_taken: "Seat already taken",
  already_holding: "You already hold a seat on this request.",
  calendar_conflict: "This overlaps a seat you already hold.",
  late_change: "Less than 48 business hours' notice. This request can only be cancelled now.",
  already_verified: "This seat is already verified.",
  not_billable: "This item is not ready to invoice.",
  duplicate_rate: "A rate already starts on that date.",
  email_taken: "That email is already in use.",
  validation: "Check the highlighted fields.",
  storage_unavailable: "File storage is unavailable. Your form was not saved. Try again shortly.",
  internal: "Something went wrong on our side. Try again shortly.",
};

export type FieldErrors = Record<string, string>;

/** Every API error is one of these; `send` turns it into the brief's error shape. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields: FieldErrors | undefined;

  constructor(code: ErrorCode, fields?: FieldErrors) {
    super(MESSAGES[code]);
    this.code = code;
    this.fields = code === "validation" ? fields ?? {} : undefined;
  }

  get status(): number {
    return STATUS[this.code];
  }

  toBody(): { error: { code: ErrorCode; message: string; fields?: FieldErrors } } {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) } };
  }
}

export interface FilePart {
  contentType: string;
  data: Buffer;
}

interface MultipartBody {
  fields: Map<string, string>;
  files: Map<string, FilePart>;
}

export interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  /** Parsed JSON body (`{}` when empty); `undefined` when the body is not valid JSON. */
  body: unknown;
  multipart: MultipartBody | null;
  session: Session | null;
}

export interface SignedInContext extends Context {
  session: Session;
}

export interface Reply {
  status: number;
  json?: unknown;
  text?: string;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

type BodyKind = "json" | "multipart";

type Route = {
  method: string;
  pattern: RegExp;
  keys: string[];
  body: BodyKind;
} & (
  | { open: false; handler: (ctx: SignedInContext) => Promise<Reply> }
  | { open: true; handler: (ctx: Context) => Promise<Reply> }
);

const routes: Route[] = [];

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/\{(\w+)\}/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

/** Register an endpoint that needs a session. */
export function route(
  method: string,
  path: string,
  handler: (ctx: SignedInContext) => Promise<Reply>,
  body: BodyKind = "json",
): void {
  routes.push({ method, ...compile(path), body, open: false, handler });
}

/** Register an endpoint anyone may call. */
export function openRoute(method: string, path: string, handler: (ctx: Context) => Promise<Reply>): void {
  routes.push({ method, ...compile(path), body: "json", open: true, handler });
}

const STATE_CHANGING = new Set(["POST", "PATCH", "DELETE"]);

function foreignOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

/** Read the whole body; reports whether it went past `limit` (reading stops counting at a hard cap). */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit * 4) {
    req.resume();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size <= limit) chunks.push(piece);
  }
  return size > limit ? null : Buffer.concat(chunks);
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function boundaryOf(req: IncomingMessage): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers["content-type"] ?? "");
  return match ? (match[1] ?? match[2] ?? "").trim() : null;
}

function parseMultipart(body: Buffer, boundary: string): MultipartBody | null {
  const fields = new Map<string, string>();
  const files = new Map<string, FilePart>();
  const delimiter = Buffer.from(`--${boundary}`);
  let position = body.indexOf(delimiter);
  if (position < 0) return null;
  while (true) {
    position += delimiter.length;
    if (body.subarray(position, position + 2).toString() === "--") break;
    position += 2; // CRLF after the delimiter
    const headerEnd = body.indexOf("\r\n\r\n", position);
    if (headerEnd < 0) return null;
    const headers = body.subarray(position, headerEnd).toString("utf8");
    const next = body.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
    if (next < 0) return null;
    const data = body.subarray(headerEnd + 4, next);
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    // A part with a filename is a file; the name itself is never used.
    const isFile = /filename="[^"]*"/i.test(headers);
    const type = /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim().toLowerCase() ?? "";
    if (name !== undefined) {
      if (isFile) files.set(name, { contentType: type, data: Buffer.from(data) });
      else fields.set(name, data.toString("utf8"));
    }
    position = next + 2;
  }
  return { fields, files };
}

function sendReply(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.json !== undefined) {
    const payload = JSON.stringify(reply.json);
    res.writeHead(reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
    res.end(payload);
  } else if (reply.text !== undefined) {
    res.writeHead(reply.status, headers);
    res.end(reply.text);
  } else {
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
  }
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendReply(res, { status: error.status, json: error.toBody() });
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const candidates = routes.filter((r) => r.pattern.test(url.pathname));
  const match = candidates.find((r) => r.method === method);
  try {
    if (STATE_CHANGING.has(method) && foreignOrigin(req)) throw new ApiError("cross_origin");
    const kind: BodyKind = match?.body ?? "json";
    const raw = await readBody(req, kind === "multipart" ? MULTIPART_LIMIT : JSON_LIMIT);
    if (raw === null) throw new ApiError("payload_too_large");
    let body: unknown = {};
    let multipart: MultipartBody | null = null;
    if (kind === "multipart" && STATE_CHANGING.has(method)) {
      const boundary = boundaryOf(req);
      if (mediaType(req) !== "multipart/form-data" || boundary === null) throw new ApiError("unsupported_media_type");
      multipart = parseMultipart(raw, boundary);
      const form = multipart?.files.get("form");
      if (form && form.data.length > FORM_LIMIT) throw new ApiError("payload_too_large");
    } else if (raw.length > 0) {
      if (mediaType(req) !== "application/json") throw new ApiError("unsupported_media_type");
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        body = undefined;
      }
    }
    const params: Record<string, string> = {};
    if (match) {
      const values = match.pattern.exec(url.pathname)?.slice(1) ?? [];
      match.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(values[index] ?? "");
      });
    }
    const ctx: Context = {
      params,
      query: url.searchParams,
      headers: req.headers,
      body,
      multipart,
      session: await findSession(req.headers.cookie),
    };
    if (match?.open) {
      sendReply(res, await match.handler(ctx));
      return;
    }
    if (ctx.session === null) throw new ApiError("unauthenticated");
    if (!match) throw new ApiError("not_found");
    sendReply(res, await match.handler({ ...ctx, session: ctx.session }));
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(error);
    sendError(res, error instanceof ApiError ? error : new ApiError("internal"));
  }
}
