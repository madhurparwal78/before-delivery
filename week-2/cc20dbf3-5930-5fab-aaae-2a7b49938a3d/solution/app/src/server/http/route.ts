// A route and the one precedence order every API request goes through:
// 1 cross_origin, 2 unauthenticated, 3 Idempotency-Key, 4 not_found, 5 forbidden,
// 6 unsupported_media_type then body_too_large, 7 validation and photo checks, 8 state conflicts,
// 9 dependency outages. Steps 1 and the route match happen in `api.ts`; the rest happen here.

import type { IncomingMessage } from "node:http";
import type { Role, User } from "../../shared/api.js";
import { FIELD_COPY } from "../../shared/copy.js";
import { tokenFromCookieHeader, userForToken } from "../domain/sessions.js";
import { ApiError } from "./errors.js";
import { fingerprint, isValidKey, withIdempotency } from "./idempotency.js";

const JSON_LIMIT = 16_384;
export const UPLOAD_LIMIT = 5_500_000;

export interface Reply {
  status: number;
  body?: unknown;
  /** A body already serialised (a replayed stored answer). */
  json?: string;
  bytes?: { data: Buffer; headers: Record<string, string> };
  headers?: Record<string, string>;
}

export interface Call {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  now: Date;
}

interface SignedCall extends Call {
  user: User;
}

type BodyKind = "none" | "json" | "multipart";

interface Spec<Found, Input> {
  method: "GET" | "POST" | "DELETE";
  path: string;
  roles: readonly Role[];
  body: BodyKind;
  keyed?: boolean;
  find?: (call: SignedCall) => Promise<Found>;
  parse?: (call: SignedCall, found: Found, json: unknown) => Promise<Input>;
  handle: (call: SignedCall, found: Found, input: Input) => Promise<Reply>;
}


export const ALL_ROLES: readonly Role[] = ["member", "volunteer", "founder"];
export const STAFF: readonly Role[] = ["volunteer", "founder"];
export const MEMBERS: readonly Role[] = ["member"];
export const FOUNDER: readonly Role[] = ["founder"];

function matcher(pattern: string): (path: string) => Record<string, string> | null {
  const names: string[] = [];
  const source = pattern.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  const regex = new RegExp(`^${source}$`);
  return (path) => {
    const found = regex.exec(path);
    if (!found) return null;
    try {
      return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(found[i + 1] ?? "")]));
    } catch {
      return null;
    }
  };
}

function contentType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function declaredLength(req: IncomingMessage): number | null {
  const header = req.headers["content-length"];
  return header === undefined ? null : Number(header);
}

/** Reads at most `limit` bytes; returns null when the body is larger, without reading the rest. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = declaredLength(req);
  if (declared !== null && declared > limit) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.off("data", onData);
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.once("end", () => resolve(Buffer.concat(chunks)));
    req.once("error", reject);
  });
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Steps 6 and the parse for a JSON body: 415 unless JSON, 413 past the limit, `undefined` when malformed. */
export async function readJson(req: IncomingMessage, raw?: Buffer | null): Promise<unknown> {
  if (contentType(req) !== "application/json") throw ApiError.of("unsupported_media_type");
  const body = raw === undefined ? await readBody(req, JSON_LIMIT) : raw;
  if (body === null) throw ApiError.of("body_too_large");
  return parseJson(body);
}

/** The caller of a signed-in request, or 401. */
async function signedInUser(req: IncomingMessage, now: Date): Promise<User> {
  const token = tokenFromCookieHeader(req.headers.cookie);
  const user = token ? await userForToken(token, now) : null;
  if (!user) throw ApiError.of("unauthenticated");
  return user;
}

export interface Route {
  method: string;
  match: (path: string) => Record<string, string> | null;
  run: (call: Call) => Promise<Reply>;
}

export function defineRoute<Found = undefined, Input = undefined>(spec: Spec<Found, Input>): Route {
  return {
    method: spec.method,
    match: matcher(spec.path),
    async run(call) {
      const user = await signedInUser(call.req, call.now);
      const signed: SignedCall = { ...call, user };

      let raw: Buffer | null | undefined;
      const jsonBody = async () => {
        if (raw === undefined) raw = await readBody(call.req, JSON_LIMIT);
        return raw;
      };

      const rest = async (keyProblem: boolean): Promise<Reply> => {
        const found = (spec.find ? await spec.find(signed) : undefined) as Found;
        if (!spec.roles.includes(user.role)) throw ApiError.of("forbidden");

        let json: unknown;
        if (spec.body === "json") {
          if (contentType(call.req) !== "application/json") throw ApiError.of("unsupported_media_type");
          json = await readJson(call.req, await jsonBody());
        } else if (spec.body === "multipart") {
          if (contentType(call.req) !== "multipart/form-data") throw ApiError.of("unsupported_media_type");
          const declared = declaredLength(call.req);
          if (declared !== null && declared > UPLOAD_LIMIT) throw ApiError.of("body_too_large");
        }

        let input: Input;
        try {
          input = (spec.parse ? await spec.parse(signed, found, json) : undefined) as Input;
        } catch (error) {
          if (keyProblem && error instanceof ApiError && error.code === "validation") {
            throw ApiError.validation({ ...error.fields, idempotency_key: FIELD_COPY.idempotency_key });
          }
          throw error;
        }
        if (keyProblem) throw ApiError.validation({ idempotency_key: FIELD_COPY.idempotency_key });
        return spec.handle(signed, found, input);
      };

      if (!spec.keyed) return rest(false);
      const keyHeader = call.req.headers["idempotency-key"];
      const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
      if (!isValidKey(key)) return rest(true);
      const body = (await jsonBody()) ?? Buffer.from("\u0000body-too-large");
      return withIdempotency(user.id, key, fingerprint(spec.method, call.url.pathname, body), call.now, () => rest(false));
    },
  };
}
