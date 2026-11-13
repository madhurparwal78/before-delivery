import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { fail } from "./http.js";

/** The built client: hashed assets, fonts and the single-page shell, and nothing outside its directory. */

const CLIENT = new URL("../client/", import.meta.url);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
};

const SHELL_ROUTE = /^\/(shelf|checkout|lookup|staff(\/(packing|dead-letters|refunds|rates|statements|plates))?|box\/\d+|order\/[A-Za-z0-9-]+)?$/;
const FILE = /^\/(assets|fonts)\/[A-Za-z0-9._-]+$/;

export const registerStatic = (app: FastifyInstance): void => {
  app.get("/*", async (request, reply) => {
    let path: string;
    try {
      path = decodeURIComponent(request.url.split("?")[0] ?? "/");
    } catch {
      return fail("not_found");
    }
    if (SHELL_ROUTE.test(path)) {
      return reply.header("content-type", TYPES[".html"]).header("cache-control", "no-cache").send(await readFile(new URL("index.html", CLIENT)));
    }
    if (!FILE.test(path)) return fail("not_found");
    const extension = path.slice(path.lastIndexOf("."));
    const bytes = await readFile(new URL(`.${path}`, CLIENT)).catch(() => null);
    if (!bytes || !TYPES[extension]) return fail("not_found");
    return reply.header("content-type", TYPES[extension]).header("cache-control", "public, max-age=31536000, immutable").send(bytes);
  });
};
