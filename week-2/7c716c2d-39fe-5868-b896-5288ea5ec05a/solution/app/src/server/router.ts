// The route table. Kept free of imports so every module can register routes at load time.
import type { Ctx, Reply } from "./http.js";

type Access = "public" | "signed-in" | "workspace";

type Handler = (ctx: Ctx) => Promise<Reply | void>;

export interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  access: Access;
  json: boolean;
  idempotent: boolean;
  handler: Handler;
}

export const routes: Route[] = [];

export function route(method: string, path: string, options: { access: Access; idempotent?: boolean; upload?: boolean }, handler: Handler): void {
  const names: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:([a-z_]+)/g, (_, name: string) => {
        names.push(name);
        return "([^/]+)";
      }) +
      "$",
  );
  routes.push({ method, pattern, names, access: options.access, json: !options.upload, idempotent: options.idempotent ?? false, handler });
}
