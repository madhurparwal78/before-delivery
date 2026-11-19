import type { IncomingMessage } from "node:http";
import type { JsonObject } from "./domain/validation.js";
import { fail, type Reply } from "./http.js";
import type { CoachViewer, DreamerViewer, Viewer } from "./viewer.js";

export interface Context {
  req: IncomingMessage;
  params: string[];
  body: JsonObject;
  raw: Buffer;
  now: Date;
}

/** How a route's request body is read before anything else: JSON, raw memo bytes, or not at all. */
type BodyKind = "json" | "memo" | "none";

export interface Route {
  method: string;
  pattern: RegExp;
  body: BodyKind;
  run(ctx: Context, viewer: Viewer | null): Promise<Reply>;
}

const bodyFor = (method: string): BodyKind => (method === "GET" ? "none" : "json");

/** An endpoint marked "(no body)": it ignores any body and skips the size, type and JSON rungs. */
export const withoutBody = (route: Route): Route => ({ ...route, body: "none" });

export function open(method: string, pattern: RegExp, handle: (ctx: Context, viewer: Viewer | null) => Promise<Reply>): Route {
  return { method, pattern, body: bodyFor(method), run: handle };
}

function signedIn(viewer: Viewer | null): Viewer {
  if (!viewer) throw fail(401, "unauthenticated");
  return viewer;
}

export function dreamerOnly(
  method: string,
  pattern: RegExp,
  handle: (ctx: Context, me: DreamerViewer) => Promise<Reply>,
  body: BodyKind = bodyFor(method),
): Route {
  return {
    method,
    pattern,
    body,
    run: async (ctx, viewer) => {
      const me = signedIn(viewer);
      if (me.role !== "dreamer") throw fail(403, "forbidden");
      return handle(ctx, me);
    },
  };
}

export function coachOnly(method: string, pattern: RegExp, handle: (ctx: Context, me: CoachViewer) => Promise<Reply>): Route {
  return {
    method,
    pattern,
    body: bodyFor(method),
    run: async (ctx, viewer) => {
      const me = signedIn(viewer);
      if (me.role !== "coach") throw fail(403, "forbidden");
      return handle(ctx, me);
    },
  };
}

export function anySession(method: string, pattern: RegExp, handle: (ctx: Context, me: Viewer) => Promise<Reply>): Route {
  return { method, pattern, body: bodyFor(method), run: async (ctx, viewer) => handle(ctx, signedIn(viewer)) };
}
