import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { one } from "./db/pool.js";
import { instantOf } from "./engine/time.js";
import { ANSWER_COPY, PASSPORT_COPY, type Lang } from "./engine/copy.js";

/**
 * The document request answers its own status: 404 for an unknown or erased address, 410
 * for an ended private page or a withdrawn passport. The server sets status, lang and dir
 * before any script runs.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = [path.resolve(HERE, "../../public"), path.resolve(HERE, "../public"), path.resolve(process.cwd(), "public")].find((d) => existsSync(d)) ?? path.resolve(process.cwd(), "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function readIndex(): string {
  return readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
}

/** The hashed asset names of the last build, discovered at boot. */
function builtAssets(): { css: string; js: string } {
  const files = readdirSync(PUBLIC_DIR);
  const css = files.find((f) => /^index\.[0-9a-f]+\.css$/.test(f)) ?? "index.css";
  const html = readIndex();
  const jsMatch = /src="\/([^"]+\.js)"/.exec(html);
  const js = jsMatch?.[1] ?? files.find((f) => /^index\.[0-9a-f]+\.js$/.test(f)) ?? "index.js";
  return { css, js };
}

interface PageMeta {
  status: number;
  lang: string;
  dir: "ltr" | "rtl";
  title: string;
}

function ok(lang: string, heading: string): PageMeta {
  return { status: 200, lang, dir: lang === "ar" ? "rtl" : "ltr", title: `${heading} \u2014 Fio Contado Desk` };
}

function notFound(): PageMeta {
  return { status: 404, lang: "en", dir: "ltr", title: `We couldn't find that page. \u2014 Fio Contado Desk` };
}

async function metaFor(pathname: string): Promise<PageMeta> {
  const now = instantOf(new Date());
  if (pathname === "/") return ok("en", `Count every thread of a garment's footprint.`);
  if (pathname === "/method") return ok("en", `How a footprint is worked out`);
  if (pathname === "/questions") return ok("en", `Questions`);
  if (pathname === "/sign-in") return ok("en", `Sign in`);
  if (pathname === "/sign-up") return ok("en", `Start a desk`);

  const answerMatch = /^\/a\/([^/]+)$/.exec(pathname);
  if (answerMatch) {
    const token = answerMatch[1];
    const r = await one<{ language: string; token: string | null; token_ends_at: string | null }>(
      `SELECT language, token, token_ends_at FROM requests WHERE token = $1`,
      [token],
    );
    if (!r || r.token === null) return notFound();
    const lang = r.language as Lang;
    if (r.token_ends_at !== null && r.token_ends_at <= now) {
      return { status: 410, lang, dir: lang === "ar" ? "rtl" : "ltr", title: `${ANSWER_COPY[lang].ended} \u2014 Fio Contado Desk` };
    }
    return { status: 200, lang, dir: lang === "ar" ? "rtl" : "ltr", title: `${ANSWER_COPY[lang].heading} \u2014 Fio Contado Desk` };
  }

  const signOffMatch = /^\/s\/([^/]+)$/.exec(pathname);
  if (signOffMatch) {
    const token = signOffMatch[1];
    const page = await one<{ dossier_id: string; ends_at: string }>(
      `SELECT dossier_id, ends_at FROM sign_off_pages WHERE token = $1`,
      [token],
    );
    if (!page) return notFound();
    if (page.ends_at <= now) {
      return { status: 410, lang: "en", dir: "ltr", title: `This page has ended. \u2014 Fio Contado Desk` };
    }
    const dossier = await one<{ style_name: string }>(
      `SELECT s.name AS style_name FROM dossiers d JOIN styles s ON s.id = d.style_id WHERE d.id = $1`,
      [page.dossier_id],
    );
    return ok("en", `Sign off ${dossier?.style_name ?? ""}`);
  }

  const passportMatch = /^\/p\/([^/]+)(?:\/e\/(\d+))?$/.exec(pathname);
  if (passportMatch) {
    const gtin = passportMatch[1];
    const edition = passportMatch[2] !== undefined ? Number.parseInt(passportMatch[2], 10) : null;
    const row = edition === null
      ? await one<{ state: string; snapshot: { styleName: string } }>(
          `SELECT state, snapshot FROM passports WHERE gtin = $1 ORDER BY edition DESC LIMIT 1`,
          [gtin],
        )
      : await one<{ state: string; snapshot: { styleName: string } }>(
          `SELECT state, snapshot FROM passports WHERE gtin = $1 AND edition = $2`,
          [gtin, edition],
        );
    if (!row) return notFound();
    if (row.state === "withdrawn") {
      return { status: 410, lang: "en", dir: "ltr", title: `${PASSPORT_COPY.en.withdrawn} \u2014 Fio Contado Desk` };
    }
    return ok("en", row.snapshot?.styleName ?? "");
  }

  // Signed-in addresses render from the served shell; the client shows what the API answers.
  if (/^\/styles(\/|$)/.test(pathname) || /^\/labels(\/|$)/.test(pathname) || /^\/requests(\/|$)/.test(pathname) ||
      /^\/visits(\/|$)/.test(pathname) || /^\/passports(\/|$)/.test(pathname)) {
    return ok("en", `Fio Contado Desk`);
  }
  return notFound();
}

export function registerPageRoutes(app: FastifyInstance): void {
  const assets = builtAssets();

  const serveFile = (name: string) => (req: FastifyRequest, reply: FastifyReply) => {
    const file = path.join(PUBLIC_DIR, name);
    if (!existsSync(file)) {
      return reply.status(404).send({ error: { code: "not_found", message: `We couldn't find that page.` } });
    }
    reply.header("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
    return reply.send(readFileSync(file));
  };

  app.get(`/${assets.css}`, serveFile(assets.css));
  app.get(`/${assets.js}`, serveFile(assets.js));

  const pageHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const pathname = decodeURIComponent(req.url.split("?")[0]);
    if (pathname.startsWith("/api/")) {
      return reply.status(404).send({ error: { code: "not_found", message: `We couldn't find that page.` } });
    }
    // Hashed build assets (scripts, styles, fonts) serve from the public root.
    const assetName = pathname.replace(/^\//, "");
    if (/^index\.[0-9a-f]+\.(js|css)$/.test(assetName) || /^[A-Za-z0-9-]+\.[0-9a-f]+\.ttf$/.test(assetName)) {
      const target = path.join(PUBLIC_DIR, assetName);
      if (target.startsWith(PUBLIC_DIR) && existsSync(target)) {
        reply.header("Content-Type", MIME[path.extname(target)] ?? "application/octet-stream");
        return reply.send(readFileSync(target));
      }
    }
    const meta = await metaFor(pathname);
    const html = readIndex()
      .replace(/<html[^>]*>/, `<html lang="${meta.lang}" dir="${meta.dir}">`)
      .replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);
    reply.status(meta.status);
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  };
  app.get("/", pageHandler);
  app.get("/*", pageHandler);
}

