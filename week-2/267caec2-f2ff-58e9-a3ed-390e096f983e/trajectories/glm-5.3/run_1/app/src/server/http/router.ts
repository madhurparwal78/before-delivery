import type { ServerResponse } from "node:http";

export interface Auth {
  userId: string;
  role: "director" | "juror" | "studio";
  name: string;
  email: string;
  studioId: string | null;
  studioName: string | null;
}

export interface Ctx {
  auth: Auth | null;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  req: import("node:http").IncomingMessage;
  res: ServerResponse;
  raw: Buffer;
  idempotencyKey: string | null;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

export type BodyWriter = (res: ServerResponse, value: unknown) => void;

export class Router {
  private readonly routes: { method: string; pattern: string; segments: string[]; roles: RoleGuard; handler: Handler }[] = [];

  add(method: string, pattern: string, roles: RoleGuard, handler: Handler): void {
    this.routes.push({ method, pattern, segments: pattern.split("/"), roles, handler });
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string>; roles: RoleGuard; pattern: string } | null {
    const segments = path.split("/");
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== segments.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segments.length; i++) {
        const patternSeg = route.segments[i];
        if (patternSeg.startsWith(":")) {
          params[patternSeg.slice(1)] = decodeURIComponent(segments[i]);
        } else if (patternSeg !== segments[i]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        return { handler: route.handler, params, roles: route.roles, pattern: route.pattern };
      }
    }
    return null;
  }
}

export type RoleGuard = "public" | "signedIn" | "director" | "juror" | "studio" | "directorOrJuror";

export function guardRole(roles: RoleGuard, auth: Auth | null): boolean {
  if (roles === "public") {
    return true;
  }
  if (!auth) {
    return false;
  }
  switch (roles) {
    case "signedIn":
      return true;
    case "director":
      return auth.role === "director";
    case "juror":
      return auth.role === "juror";
    case "studio":
      return auth.role === "studio";
    case "directorOrJuror":
      return auth.role === "director" || auth.role === "juror";
  }
}
