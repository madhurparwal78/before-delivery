import type { IncomingMessage, ServerResponse } from "node:http";
import { first } from "../db/pool";
import { isTeam, type Viewer } from "../domain/viewer";
import type { Role } from "../../shared/reference";
import { invalidFields, refuse } from "./fail";
import { boundaryOf, parseMultipart, type Multipart } from "./multipart";

export const JSON_LIMIT = 65536;
export const UPLOAD_ALLOWANCE = 1048576;

export type BodyKind = "none" | "json" | "multipart" | "png";
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  file?: { contentType: string; data: Buffer };
};

export interface Ctx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly params: Record<string, string>;
  readonly viewer: Viewer | null;
  /** The parsed JSON body; undefined when the body is absent or malformed. */
  readonly json: unknown;
  readonly jsonMalformed: boolean;
  readonly form: Multipart | undefined;
  readonly raw: Buffer | undefined;
}

interface RouteSpec<Loaded, Input> {
  method: Method;
  path: string;
  auth: "public" | "session";
  roles?: readonly Role[];
  /** The caller's team must be verified (403 not_verified) after the role check. */
  verified?: boolean;
  body?: BodyKind;
  /** Step 2: unknown or hidden records answer 404. */
  load?: (ctx: Ctx) => Promise<Loaded>;
  /** Step 4: 429. */
  limit?: (ctx: Ctx, loaded: Loaded) => Promise<void>;
  /** Step 5: 409. */
  conflicts?: (ctx: Ctx, loaded: Loaded) => Promise<void>;
  /** Step 6: 422. */
  input?: (ctx: Ctx, loaded: Loaded) => Promise<Input> | Input;
  run: (ctx: Ctx, loaded: Loaded, input: Input) => Promise<Reply>;
}

export type Handler = {
  method: Method;
  pattern: RegExp;
  keys: string[];
  body: BodyKind;
  execute: (ctx: Ctx) => Promise<Reply>;
};

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function defineRoute<Loaded = undefined, Input = undefined>(spec: RouteSpec<Loaded, Input>): Handler {
  const { pattern, keys } = compile(spec.path);
  const body = spec.body ?? "none";
  return {
    method: spec.method,
    pattern,
    keys,
    body,
    async execute(ctx) {
      if (spec.auth === "session" && !ctx.viewer) throw refuse("unauthenticated");
      const loaded = (spec.load ? await spec.load(ctx) : undefined) as Loaded;
      if (spec.roles && ctx.viewer && !spec.roles.includes(ctx.viewer.role)) throw refuse("forbidden");
      if (spec.verified && ctx.viewer) await requireVerifiedTeam(ctx.viewer);
      if (spec.limit) await spec.limit(ctx, loaded);
      if (spec.conflicts) await spec.conflicts(ctx, loaded);
      const input = (spec.input ? await spec.input(ctx, loaded) : undefined) as Input;
      return spec.run(ctx, loaded, input);
    },
  };
}

async function requireVerifiedTeam(viewer: Viewer): Promise<void> {
  if (!isTeam(viewer)) return;
  const company = await first<{ verified: boolean }>("SELECT verified FROM companies WHERE id = $1", [viewer.companyId]);
  if (!company?.verified) throw refuse("not_verified");
}

type RawBody = { json: unknown; jsonMalformed: boolean; form: Multipart | undefined; raw: Buffer | undefined };

/** PostgreSQL text cannot hold a NUL character, so no NUL reaches a query: a JSON body that carries one is refused. */
function hasNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some(hasNul);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([key, inner]) => key.includes("\u0000") || hasNul(inner));
  }
  return false;
}

function withoutNul(form: Multipart): Multipart {
  const clean = (text: string): string => text.replaceAll("\u0000", "");
  return {
    fields: Object.fromEntries(Object.entries(form.fields).map(([key, text]) => [clean(key), clean(text)])),
    files: form.files.map((file) => ({ ...file, field: clean(file.field), filename: clean(file.filename) })),
  };
}

/** Reads the request body, answering 413 as soon as the limit is passed. */
export async function readBody(req: IncomingMessage, kind: BodyKind, limit: number): Promise<RawBody> {
  const empty: RawBody = { json: undefined, jsonMalformed: false, form: undefined, raw: undefined };
  if (kind === "none") return empty;
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw refuse("payload_too_large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size > limit) throw refuse("payload_too_large");
    chunks.push(piece);
  }
  const data = Buffer.concat(chunks);
  if (kind === "png") return { ...empty, raw: data };
  if (kind === "multipart") {
    const boundary = boundaryOf(req.headers["content-type"]);
    return { ...empty, form: boundary ? withoutNul(parseMultipart(data, boundary)) : { fields: {}, files: [] } };
  }
  if (data.length === 0) return empty;
  try {
    const json: unknown = JSON.parse(data.toString("utf8"));
    return hasNul(json) ? { ...empty, jsonMalformed: true } : { ...empty, json };
  } catch {
    return { ...empty, jsonMalformed: true };
  }
}

export function requireJsonObject(ctx: Ctx): unknown {
  if (ctx.jsonMalformed) throw invalidFields({});
  return ctx.json;
}

export function jsonField(ctx: Ctx, name: string): unknown {
  const body = ctx.json;
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined;
}

