// The request pipeline: the error-precedence ladder, the body limits and the single place an answer is written.

import type { IncomingMessage, ServerResponse } from "node:http";
import { Busboy, type BusboyInstance } from "@fastify/busboy";
import type { Role } from "../shared/api";
import type { JsonBody } from "./fields";
import { ApiError, errorBody, forbidden, invalid, notFound, tooLarge } from "./errors";
import { isRecord } from "./fields";

const JSON_LIMIT = 65536;
const NUL_COPY = "This can't include a null character.";

export interface Caller {
  id: string;
  name: string;
  role: Role;
  tokenHash: string;
  expiresAt: Date;
}

export type SessionLookup = { kind: "none" } | { kind: "ended" } | { kind: "live"; caller: Caller };

export interface Multipart {
  fields: Map<string, string>;
  files: Map<string, Buffer>;
}

interface MultipartSpec {
  bodyLimit: number;
  partLimits: Readonly<Record<string, { limit: number; message: string }>>;
}


export interface ApiRequest {
  param(name: string): string;
  query: URLSearchParams;
  rawBody: Buffer;
  header(name: string): string | undefined;
  peekJson(): JsonBody | null;
}

export interface Reply {
  status: number;
  json?: unknown;
  raw?: Buffer | string;
  headers?: Record<string, string>;
}

interface Parsed {
  json: JsonBody;
  multipart: Multipart;
}

type BodyKind = "none" | "json" | MultipartSpec;

interface Common<L, C> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: BodyKind;
  rate?: (caller: Caller) => Promise<void>;
  locate: (request: ApiRequest, caller: C) => Promise<L>;
}

interface SignedInSpec<L> extends Common<L, Caller> {
  roles: readonly Role[] | ((request: ApiRequest) => readonly Role[]);
  handle: (request: ApiRequest & Parsed & { caller: Caller }, located: L) => Promise<Reply>;
}

interface OpenSpec<L> extends Common<L, null> {
  handle: (request: ApiRequest & Parsed & { lookup: SessionLookup }, located: L) => Promise<Reply>;
}

export interface Route {
  method: string;
  pieces: string[];
  body: BodyKind;
  rate: ((caller: Caller) => Promise<void>) | undefined;
  run(request: ApiRequest, lookup: SessionLookup, parse: () => Parsed): Promise<Reply>;
}

function pieces(path: string): string[] {
  return path.split("/").slice(1);
}

function bodyKindOf(spec: { method: string; body?: BodyKind }): BodyKind {
  return spec.body ?? (spec.method === "GET" || spec.method === "DELETE" ? "none" : "json");
}

const nothing = async (): Promise<undefined> => undefined;

// Rung 4 onward for a route that needs a session and locates the ids it names at rung 5.
export function locatedRoute<L>(spec: SignedInSpec<L>): Route {
  return {
    method: spec.method,
    pieces: pieces(spec.path),
    body: bodyKindOf(spec),
    rate: spec.rate,
    async run(request, lookup, parse) {
      if (lookup.kind === "none") throw new ApiError(401, "not_signed_in", "Sign in first.");
      if (lookup.kind === "ended") {
        throw new ApiError(401, "session_ended", "Your session ended. Sign in again to keep going — what you typed is still here.");
      }
      const { caller } = lookup;
      const located = await spec.locate(request, caller);
      const allowed = typeof spec.roles === "function" ? spec.roles(request) : spec.roles;
      if (!allowed.includes(caller.role)) throw forbidden();
      return spec.handle({ ...request, ...parse(), caller }, located);
    },
  };
}

export function route(spec: Omit<SignedInSpec<undefined>, "locate">): Route {
  return locatedRoute({ ...spec, locate: nothing });
}

// A route with no session rung: public reads and the visit page, where the token is the capability.
export function locatedOpenRoute<L>(spec: OpenSpec<L>): Route {
  return {
    method: spec.method,
    pieces: pieces(spec.path),
    body: bodyKindOf(spec),
    rate: undefined,
    async run(request, lookup, parse) {
      const located = await spec.locate(request, null);
      return spec.handle({ ...request, ...parse(), lookup }, located);
    },
  };
}

export function openRoute(spec: Omit<OpenSpec<undefined>, "locate">): Route {
  return locatedOpenRoute({ ...spec, locate: nothing });
}

function matches(route: Route, path: string[]): Map<string, string> | null {
  if (route.pieces.length !== path.length) return null;
  const params = new Map<string, string>();
  for (const [index, piece] of route.pieces.entries()) {
    const value = path[index] ?? "";
    if (piece.startsWith(":")) params.set(piece.slice(1), value);
    else if (piece !== value) return null;
  }
  return params;
}

function parseJsonObject(body: Buffer, reviver?: (key: string, value: unknown) => unknown): JsonBody | null {
  try {
    const value: unknown = JSON.parse(body.toString("utf8"), reviver);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

// Postgres can't store a NUL. An id or a query value holding one matches nothing; a text field holding one is refused.
function withoutNul(value: string): string {
  return value.replaceAll("\0", "\uFFFD");
}

function nulField(value: unknown, path = ""): string | null {
  if (typeof value === "string") return value.includes("\0") ? path : null;
  if (typeof value !== "object" || value === null) return null;
  for (const [key, item] of Object.entries(value)) {
    const found = nulField(item, path === "" ? key : `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

function isDecodable(value: string): boolean {
  try {
    decodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function isMultipartSpec(body: BodyKind): body is MultipartSpec {
  return typeof body === "object";
}

function declaredLength(request: IncomingMessage): number {
  return Number(request.headers["content-length"] ?? "0");
}

// Rung 2 for a plain body: reads up to the limit, counting while it streams.
function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (declaredLength(request) > limit) {
      request.resume();
      reject(tooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let seen = 0;
    request.on("data", (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > limit) {
        chunks.length = 0;
        reject(tooLarge());
      } else {
        chunks.push(chunk);
      }
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

interface MultipartRead {
  parts: Multipart;
  malformed: boolean;
}

// Rung 2 for an upload: each file part is measured as it streams. A malformed body waits for rung 8.
function readMultipart(request: IncomingMessage, spec: MultipartSpec): Promise<MultipartRead> {
  return new Promise((resolve, reject) => {
    if (declaredLength(request) > spec.bodyLimit) {
      request.resume();
      reject(tooLarge());
      return;
    }
    const parts: Multipart = { fields: new Map(), files: new Map() };
    let parser: BusboyInstance;
    try {
      const headers = { ...request.headers, "content-type": request.headers["content-type"] ?? "" };
      parser = new Busboy({ headers, limits: { fieldSize: spec.bodyLimit } });
    } catch {
      request.resume();
      request.on("end", () => resolve({ parts, malformed: true }));
      return;
    }
    let seen = 0;
    let refused = false;
    const refuse = (message?: string): void => {
      if (refused) return;
      refused = true;
      request.unpipe(parser);
      request.resume();
      reject(tooLarge(message));
    };
    request.on("data", (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > spec.bodyLimit) refuse();
    });
    parser.on("field", (name, value) => parts.fields.set(name, value));
    parser.on("file", (name, stream) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      const rule = spec.partLimits[name];
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (rule && bytes > rule.limit) refuse(rule.message);
        else if (!refused) chunks.push(chunk);
      });
      stream.on("error", () => resolve({ parts, malformed: true }));
      stream.on("end", () => parts.files.set(name, Buffer.concat(chunks)));
    });
    parser.on("finish", () => resolve({ parts, malformed: false }));
    parser.on("error", () => {
      request.unpipe(parser);
      request.resume();
      resolve({ parts, malformed: true });
    });
    request.pipe(parser);
  });
}

function writeReply(response: ServerResponse, reply: Reply): void {
  const headers = reply.headers ?? {};
  if (reply.json !== undefined) {
    response.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    response.end(JSON.stringify(reply.json));
    return;
  }
  response.writeHead(reply.status, headers);
  response.end(reply.raw);
}

export function writeError(response: ServerResponse, error: ApiError): void {
  writeReply(response, { status: error.status, json: errorBody(error), ...(error.headers ? { headers: error.headers } : {}) });
}

export function writeUnexpected(response: ServerResponse, error: unknown): void {
  console.error(error);
  if (!response.headersSent) {
    writeError(response, new ApiError(500, "internal", "Something went wrong. Please try again."));
  }
}

export function pipeline(routes: readonly Route[], readSession: (cookieHeader: string | undefined) => Promise<SessionLookup>) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
    try {
      const reply = await answer(routes, readSession, request, url);
      writeReply(response, reply);
    } catch (error) {
      if (error instanceof ApiError) writeError(response, error);
      else writeUnexpected(response, error);
    }
  };
}

async function answer(
  routes: readonly Route[],
  readSession: (cookieHeader: string | undefined) => Promise<SessionLookup>,
  incoming: IncomingMessage,
  url: URL,
): Promise<Reply> {
  // Rung 1: the route and the method.
  const path = url.pathname.split("/").slice(1);
  const found = routes.flatMap((entry) => {
    const params = matches(entry, path);
    return params ? [{ entry, params }] : [];
  });
  if (found.length === 0) throw notFound();
  const chosen = found.find(({ entry }) => entry.method === incoming.method);
  if (!chosen) {
    const allow = [...new Set(found.map(({ entry }) => entry.method))].join(", ");
    throw new ApiError(405, "method_not_allowed", "That method isn't allowed here.", undefined, { Allow: allow });
  }
  const { entry, params } = chosen;
  const contentType = (incoming.headers["content-type"] ?? "").toLowerCase();

  // Rung 2: every size limit, before anything is parsed or authenticated.
  let rawBody: Buffer = Buffer.alloc(0);
  let upload: MultipartRead = { parts: { fields: new Map(), files: new Map() }, malformed: true };
  if (isMultipartSpec(entry.body) && contentType.startsWith("multipart/form-data")) {
    upload = await readMultipart(incoming, entry.body);
  } else {
    rawBody = await readBody(incoming, isMultipartSpec(entry.body) ? entry.body.bodyLimit : JSON_LIMIT);
  }

  // Rung 3: the rate limit applies only with a valid session.
  const lookup = await readSession(incoming.headers.cookie);
  if (lookup.kind === "live") await entry.rate?.(lookup.caller);

  const request: ApiRequest = {
    param: (name) => {
      const value = params.get(name);
      if (value === undefined || !isDecodable(value)) throw notFound();
      const decoded = decodeURIComponent(value);
      if (decoded.includes("\0")) throw notFound();
      return decoded;
    },
    query: new URLSearchParams([...url.searchParams].map(([name, value]) => [name, withoutNul(value)])),
    rawBody,
    header: (name) => {
      const value = incoming.headers[name];
      return typeof value === "string" ? value : undefined;
    },
    peekJson: () => parseJsonObject(rawBody, (_key, value) => (typeof value === "string" ? withoutNul(value) : value)),
  };

  // Rungs 7 and 8 run inside `run`, after the route has located its ids and checked the role.
  const parse = (): Parsed => {
    const empty: Multipart = { fields: new Map(), files: new Map() };
    if (entry.body === "none") return { json: {}, multipart: empty };
    if (isMultipartSpec(entry.body)) {
      if (!contentType.startsWith("multipart/form-data")) {
        throw new ApiError(415, "unsupported_media_type", "Send this as multipart/form-data.");
      }
      if (upload.malformed) throw new ApiError(400, "bad_request", "That upload could not be read.");
      const nulPart = nulField(Object.fromEntries(upload.parts.fields));
      if (nulPart !== null) throw invalid({ [nulPart]: NUL_COPY });
      return { json: {}, multipart: upload.parts };
    }
    if (!contentType.startsWith("application/json")) {
      throw new ApiError(415, "unsupported_media_type", "Send this as application/json.");
    }
    const json = parseJsonObject(rawBody);
    if (!json) throw new ApiError(400, "bad_request", "That request body could not be read.");
    const nulKey = nulField(json);
    if (nulKey !== null) throw invalid({ [nulKey]: NUL_COPY });
    return { json, multipart: empty };
  };

  return entry.run(request, lookup, parse);
}
