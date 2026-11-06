import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { notFound, sendError } from "./errors.js";

// The browser app: built assets from dist/web, and index.html for every published page with the page's
// HTTP status (404 for unknown, withdrawn, draft or unpublished addresses). Nothing else is served.

const WEB_ROOT = fileURLToPath(new URL("../../../web/", import.meta.url));
const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".png": "image/png",
};

export interface PageRule {
  path: string;
  /** Whether the page's record exists and is visible at this address. */
  exists: (params: Record<string, string>) => Promise<boolean>;
  /** Values the page shows before any API call, sent as `<meta name="plumbline-<key>">` tags. */
  meta?: (params: Record<string, string>) => Promise<Record<string, string>>;
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const always = async (): Promise<boolean> => true;
const SECTIONS = new Set(["stages", "drawings", "tenders", "variations", "certificates", "shop-drawings", "site-walk", "finishes"]);

const STATIC_PAGES: PageRule[] = [
  "/", "/work", "/start", "/sign-in", "/office", "/office/members", "/office/case-studies",
  "/office/enquiries", "/office/tenders/:id", "/office/tenders/:id/levelling",
].map((path) => ({ path, exists: always }));
STATIC_PAGES.push({ path: "/office/projects/:id/:section", exists: async (params) => SECTIONS.has(params.section) });

interface Compiled {
  rule: PageRule;
  pattern: RegExp;
  names: string[];
}

let indexHtml: string | null = null;

export class Pages {
  private readonly compiled: Compiled[];

  constructor(rules: PageRule[]) {
    this.compiled = [...STATIC_PAGES, ...rules].map((rule) => {
      const names: string[] = [];
      const source = rule.path.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
        names.push(name);
        return "([^/]+)";
      });
      return { rule, pattern: new RegExp(`^${source}/?$`), names };
    });
  }

  async serve(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(res, notFound());
      return;
    }
    if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/") || url.pathname === "/favicon.svg") {
      await this.asset(res, url.pathname);
      return;
    }
    const page = await this.known(url.pathname);
    const status = page.exists ? 200 : 404;
    indexHtml ??= readFileSync(join(WEB_ROOT, "index.html"), "utf8");
    const tags = Object.entries(page.meta).map(([key, value]) => `<meta name="plumbline-${key}" content="${escapeAttribute(value)}">`);
    if (status === 404) tags.push('<meta name="plumbline-status" content="404">');
    const html = tags.length ? indexHtml.replace("<head>", `<head>${tags.join("")}`) : indexHtml;
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : html);
  }

  private async known(path: string): Promise<{ exists: boolean; meta: Record<string, string> }> {
    for (const { rule, pattern, names } of this.compiled) {
      const found = pattern.exec(path);
      if (!found) continue;
      const params: Record<string, string> = {};
      names.forEach((name, index) => (params[name] = decodeURIComponent(found[index + 1])));
      const exists = await rule.exists(params);
      return { exists, meta: exists && rule.meta ? await rule.meta(params) : {} };
    }
    return { exists: false, meta: {} };
  }

  private async asset(res: ServerResponse, path: string): Promise<void> {
    const type = ASSET_TYPES[extname(path)];
    const file = normalize(join(WEB_ROOT, path));
    if (!type || !file.startsWith(WEB_ROOT) || path.endsWith(".map")) {
      sendError(res, notFound());
      return;
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
      res.end(data);
    } catch {
      sendError(res, notFound());
    }
  }
}
