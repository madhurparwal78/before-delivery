import { PREVIEW_SOURCE, type RenderTicket, type User } from "../shared/types.js";
import { config, RENDER_LIFETIME_MINUTES } from "./config.js";
import { pool } from "./db.js";
import { validation } from "./errors.js";
import { newId, newToken } from "./ids.js";
import { guardLoops } from "./loop-guard.js";
import { visiblePen } from "./pens.js";
import { previewRuntime } from "./preview-runtime.js";
import { shelfScriptPath } from "./shelf.js";
import { starterOf } from "./starters.js";
import { isFiles, isShelfSelection, NO_FILES, readVersion, type Content } from "./versions.js";

interface RenderRow {
  id: string;
  nonce: string;
  html: string;
  css: string;
  js: string;
  libraries: string[];
}

async function penContent(penId: string, version: unknown, viewer: User | null): Promise<Content> {
  const pen = await visiblePen(penId, viewer);
  if (version !== undefined && (!Number.isInteger(version) || (version as number) < 1)) {
    throw validation({ version: "Send a version number from 1." });
  }
  if (pen.starter !== null && (version === undefined || version === 1)) {
    const starter = starterOf(pen.starter);
    return { files: starter.files, libraries: starter.libraries };
  }
  if (version === undefined && pen.head === 0) return { files: NO_FILES, libraries: [] };
  return readVersion(pen.id, (version as number | undefined) ?? pen.head);
}

function typedContent(body: Record<string, unknown>): Content {
  const files = { html: body["html"], css: body["css"], js: body["js"] };
  const libraries = body["libraries"];
  if (!isFiles(files)) throw validation({ files: "Send html, css and js as text." });
  if (!isShelfSelection(libraries)) throw validation({ libraries: "Pick each library once, from the pinned shelf." });
  return { files, libraries };
}

export async function createRender(body: Record<string, unknown>, viewer: User | null): Promise<RenderTicket> {
  const content =
    typeof body["pen_id"] === "string" ? await penContent(body["pen_id"], body["version"], viewer) : typedContent(body);
  const id = newId(16);
  const nonce = newToken().slice(0, 24);
  const penId = typeof body["pen_id"] === "string" ? body["pen_id"] : null;
  await pool.query(
    `INSERT INTO renders (id, nonce, html, css, js, libraries, pen_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp() + make_interval(mins => $8))`,
    [id, nonce, content.files.html, content.files.css, content.files.js, content.libraries, penId, RENDER_LIFETIME_MINUTES],
  );
  return { render: id, nonce, url: `/preview/${id}` };
}

export function purgeRenders(): Promise<unknown> {
  return pool.query("DELETE FROM renders WHERE expires_at < clock_timestamp()");
}

export function previewPolicy(origin: string): string {
  return [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'unsafe-inline' ${origin}/shelf/`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data: blob:",
    "connect-src 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

export async function previewDocument(id: string): Promise<string | null> {
  const found = await pool.query<RenderRow>(
    "SELECT id, nonce, html, css, js, libraries FROM renders WHERE id = $1 AND expires_at > clock_timestamp()",
    [id],
  );
  const row = found.rows[0];
  if (!row) return null;
  const libraries = row.libraries.map((library) => `<script src="${shelfScriptPath(library)}"></script>`);
  const beforeScript = (firstLine: number): string =>
    [
      "<!doctype html>",
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
      `<script>(${previewRuntime.toString()})(${JSON.stringify({
        render: row.id,
        nonce: row.nonce,
        loopLimit: config.loopLimit,
        source: PREVIEW_SOURCE,
        firstLine,
      })})</script>`,
      `<style>${row.css.replace(/<\/style/gi, "<\\/style")}</style>`,
      "</head>",
      "<body>",
      row.html,
      ...libraries,
      "<script>",
    ].join("\n");
  const firstLine = beforeScript(0).split("\n").length;
  const script = guardLoops(row.js, config.loopLimit).replace(/<\/script/gi, "<\\/script");
  return `${beforeScript(firstLine)}${script}</script>\n</body></html>`;
}
