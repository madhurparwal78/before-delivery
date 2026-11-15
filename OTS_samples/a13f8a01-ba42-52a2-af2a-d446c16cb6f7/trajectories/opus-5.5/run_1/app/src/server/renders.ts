import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { findShelfEntry, shelfPath } from "../shared/shelf";
import type { Files, Version } from "../shared/types";
import { loadVisiblePen } from "./access";
import { config } from "./config";
import { emptyFiles } from "./diff";
import { one, pool } from "./db";
import { notFound } from "./errors";
import { json, readJson, type Context, type Reply } from "./http";
import { guardLoops } from "./loopGuard";
import { findVersion, parseSnapshot, type Snapshot } from "./versions";

const runtimeSource = readFileSync(new URL("./preview-runtime.js", import.meta.url), "utf8");
const loopReporter = "__ashlarStopLoop";
export const renderLifetimeHours = 6;

interface RenderRow {
  id: string;
  nonce: string;
  html: Buffer;
  css: Buffer;
  js: Buffer;
  libraries: string[];
}

function escapeClosing(text: string, tag: "script" | "style"): string {
  return text.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
}

function lineBreaks(text: string): number {
  return (text.match(/\r\n|\r|\n/g) ?? []).length;
}

export function previewDocument(render: { id: string; nonce: string; files: Files; libraries: string[] }): string {
  const head = `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n`;
  const style = `<style>\n${escapeClosing(render.files.css, "style")}\n</style>\n</head>\n<body>\n`;
  const libraries = render.libraries
    .map((id) => findShelfEntry(id))
    .filter((entry) => entry !== undefined)
    .map((entry) => `<script src="${shelfPath(entry)}"></script>\n`)
    .join("");
  const bodyBeforeJs = `${render.files.html}\n${libraries}<script>`;
  const runtimeConfigPlaceholder = (jsStartLine: number) =>
    `<script>(function(){${escapeClosing(runtimeSource, "script")};AshlarRuntime.start(${JSON.stringify({
      render: render.id,
      nonce: render.nonce,
      loopLimit: config.loopLimit,
      jsStartLine,
      loopReporter,
    })});})();document.currentScript.remove();</script>\n`;
  const linesBefore = lineBreaks(head) + lineBreaks(runtimeConfigPlaceholder(0)) + lineBreaks(style) + lineBreaks(bodyBeforeJs);
  const js = escapeClosing(guardLoops(render.files.js, config.loopLimit, loopReporter), "script");
  return `${head}${runtimeConfigPlaceholder(linesBefore + 1)}${style}${bodyBeforeJs}${js}</script>\n</body>\n</html>\n`;
}

function previewPolicy(req: IncomingMessage): string {
  const protocol = new URL(config.publicUrl).protocol;
  const origins = new Set([config.publicOrigin, `${protocol}//${req.headers.host ?? new URL(config.publicUrl).host}`]);
  const shelfSources = [...origins].map((origin) => `${origin}/shelf/`).join(" ");
  return [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'unsafe-inline' ${shelfSources}`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data: blob:",
    "media-src data: blob:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

async function snapshotForRender(ctx: Context): Promise<{ penId: string | null; snapshot: Snapshot }> {
  const body = readJson(ctx);
  if (body.pen_id !== undefined) {
    const pen = await loadVisiblePen(pool, String(body.pen_id), ctx.user);
    const number = body.version === undefined ? pen.head : body.version;
    if (number === 0 && pen.head === 0) return { penId: pen.id, snapshot: { files: emptyFiles, libraries: [] } };
    const version = typeof number === "number" && Number.isInteger(number) ? await findVersion(pool, pen.id, number) : null;
    if (!version) throw notFound();
    return { penId: pen.id, snapshot: snapshotOf(version) };
  }
  return { penId: null, snapshot: parseSnapshot({ files: { html: body.html, css: body.css, js: body.js }, libraries: body.libraries }) };
}

function snapshotOf(version: Version): Snapshot {
  return { files: version.files, libraries: version.libraries };
}

export async function createRender(ctx: Context): Promise<Reply> {
  const { penId, snapshot } = await snapshotForRender(ctx);
  const id = randomBytes(15).toString("base64url").replace(/[-_]/g, "x");
  const nonce = randomBytes(18).toString("base64url");
  await pool.query("INSERT INTO renders (id, nonce, pen_id, html, css, js, libraries) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
    id,
    nonce,
    penId,
    Buffer.from(snapshot.files.html, "utf8"),
    Buffer.from(snapshot.files.css, "utf8"),
    Buffer.from(snapshot.files.js, "utf8"),
    snapshot.libraries,
  ]);
  return json(201, { render: id, nonce, url: `/preview/${id}` });
}

export async function servePreview(ctx: Context): Promise<Reply> {
  const row = await one<RenderRow>(
    pool,
    `SELECT id, nonce, html, css, js, libraries FROM renders WHERE id = $1 AND created_at > now() - make_interval(hours => $2)`,
    [ctx.params[0], renderLifetimeHours],
  );
  if (!row) return { kind: "raw", status: 404, body: "Not found", headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } };
  const document = previewDocument({
    id: row.id,
    nonce: row.nonce,
    files: { html: row.html.toString("utf8"), css: row.css.toString("utf8"), js: row.js.toString("utf8") },
    libraries: row.libraries,
  });
  return {
    kind: "raw",
    status: 200,
    body: document,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": previewPolicy(ctx.req),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  };
}
