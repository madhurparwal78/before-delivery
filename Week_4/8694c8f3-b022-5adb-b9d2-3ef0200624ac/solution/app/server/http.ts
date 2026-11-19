import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, forbidden, notFound, tooLarge, unauthenticated, unsupportedMediaType, validation, writeError } from "./errors.ts";
import type { Parsed, Schema } from "../shared/schema.ts";
import { parseBody } from "../shared/schema.ts";
import type { MultipartForm } from "./multipart.ts";
import { parseMultipart } from "./multipart.ts";
import type { AccountRow } from "./accounts.ts";

const JSON_LIMIT = 1_000_000;
const MODEL_LIMIT = 20_000_000;
const TEXTURE_LIMIT = 8_000_000;
const IMPORT_LIMIT = 50_000_000;
const MULTIPART_OVERHEAD = 65_536;

type BodyKind = "none" | "json" | "upload" | "import";

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  user: AccountRow | null;
  json: unknown;
  form: MultipartForm | null;
}

type Handler = (ctx: RequestContext) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  body: BodyKind;
  public: boolean;
  handler: Handler;
}

export class Router {
  readonly routes: Route[] = [];

  add(method: string, path: string, options: { body?: BodyKind; public?: boolean }, handler: Handler): void {
    const keys: string[] = [];
    const source = path.replace(/:([a-zA-Z]+)/g, (_match, key: string) => {
      keys.push(key);
      return "([^/]+)";
    });
    this.routes.push({
      method, pattern: new RegExp(`^${source}$`), keys, body: options.body ?? "none", public: options.public ?? false, handler,
    });
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const found = route.pattern.exec(pathname);
      if (!found) continue;
      const params: Record<string, string> = {};
      let clean = true;
      route.keys.forEach((key, index) => {
        let value = "";
        try {
          value = decodeURIComponent(found[index + 1] ?? "");
        } catch {
          clean = false;
        }
        // A path parameter is an id or token: control characters (NUL above all) never name a record.
        if (/[\u0000-\u001f\u007f]/.test(value)) clean = false;
        params[key] = value;
      });
      if (!clean) return null;
      return { route, params };
    }
    return null;
  }
}

interface RawBody {
  bytes: Buffer;
  overflow: boolean;
}

async function readBody(req: IncomingMessage, limit: number): Promise<RawBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) overflow = true;
  const hardCap = limit * 2 + MULTIPART_OVERHEAD;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) overflow = true;
    if (size > hardCap) {
      req.destroy();
      break;
    }
    if (!overflow) chunks.push(buffer);
  }
  return { bytes: overflow ? Buffer.alloc(0) : Buffer.concat(chunks), overflow };
}

function bodyLimit(kind: BodyKind): number {
  if (kind === "upload") return MODEL_LIMIT + MULTIPART_OVERHEAD;
  if (kind === "import") return IMPORT_LIMIT + MULTIPART_OVERHEAD;
  return JSON_LIMIT;
}

function fileLimitFor(kind: BodyKind, form: MultipartForm): number {
  if (kind === "import") return IMPORT_LIMIT;
  return form.fields.get("kind") === "texture" ? TEXTURE_LIMIT : MODEL_LIMIT;
}

async function readRequestBody(ctx: RequestContext, kind: BodyKind): Promise<void> {
  const method = ctx.req.method ?? "GET";
  if (kind === "none" && !["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
  const raw = await readBody(ctx.req, bodyLimit(kind === "none" ? "json" : kind));
  if (raw.overflow) throw tooLarge();
  const rawType = ctx.req.headers["content-type"] ?? "";
  const contentType = rawType.toLowerCase();
  if (kind === "json" || kind === "none") {
    if (raw.bytes.length === 0) return;
    if (!contentType.startsWith("application/json")) throw unsupportedMediaType();
    if (kind === "none") return;
    try {
      ctx.json = JSON.parse(raw.bytes.toString("utf8"));
    } catch {
      throw validation({ body: "Body must be valid JSON" });
    }
    return;
  }
  if (!contentType.startsWith("multipart/form-data")) throw unsupportedMediaType();
  const form = parseMultipart(raw.bytes, rawType);
  if (!form) throw validation({ file: "Send a multipart form with a file" });
  if ((form.file?.bytes.length ?? 0) > fileLimitFor(kind, form)) throw tooLarge();
  ctx.form = form;
}

/** A whole-number query parameter: undefined when absent, null when present but not a whole number. */
export function integerParam(url: URL, name: string): number | null | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export function parsedJson<T>(ctx: RequestContext, schema: Schema<T>): T {
  const parsed: Parsed<T> = parseBody(schema, ctx.json ?? {});
  if (!parsed.ok) throw validation(parsed.fields);
  return parsed.value;
}

export function requireUser(ctx: RequestContext): AccountRow {
  if (!ctx.user) throw unauthenticated();
  return ctx.user;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers["origin"];
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers["host"];
  } catch {
    return false;
  }
}

export async function dispatch(
  router: Router,
  ctx: Omit<RequestContext, "params" | "json" | "form" | "user">,
  resolveUser: (req: IncomingMessage) => Promise<AccountRow | null>,
): Promise<void> {
  const method = ctx.req.method ?? "GET";
  try {
    const found = router.match(method, ctx.url.pathname);
    const context: RequestContext = { ...ctx, params: found?.params ?? {}, user: null, json: undefined, form: null };
    await readRequestBody(context, found?.route.body ?? "none");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !sameOrigin(ctx.req)) throw forbidden();
    if (!found) throw notFound();
    if (!found.route.public) {
      context.user = await resolveUser(ctx.req);
      if (!context.user) throw unauthenticated();
    }
    await found.route.handler(context);
  } catch (error) {
    if (error instanceof ApiError) {
      if (!ctx.res.headersSent) writeError(ctx.res, error);
      return;
    }
    if (!ctx.res.headersSent) {
      writeError(ctx.res, new ApiError(500, "internal_error", "Something went wrong"));
    }
    ctx.res.end();
  }
}
