import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { pageCopy } from "../shared/notices.js";
import { sendHtml } from "./http.js";
import { publicMessagePage } from "./snapshot.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Exactly the built client files and fonts; nothing else on disk is ever served. */
const files = new Map<string, { type: string; bytes: Buffer }>();
for (const folder of ["assets", "fonts"]) {
  for (const name of readdirSync(join(PUBLIC, folder))) {
    const ext = name.slice(name.lastIndexOf("."));
    if (TYPES[ext]) files.set(`/${folder}/${name}`, { type: TYPES[ext], bytes: readFileSync(join(PUBLIC, folder, name)) });
  }
}

const version = Date.now().toString(36);

export function serveStatic(res: ServerResponse, pathname: string, head: boolean): boolean {
  const file = files.get(pathname);
  if (!file) return false;
  res.writeHead(200, {
    "Content-Type": file.type,
    "Content-Length": file.bytes.length,
    "Cache-Control": pathname.startsWith("/fonts/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(head ? undefined : file.bytes);
  return true;
}

/** The client shell for the account screens, workspace list and editor. */
export function sendShell(res: ServerResponse): void {
  sendHtml(
    res,
    200,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Plinth</title>` +
      `<link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>` +
      `<link rel="stylesheet" href="/assets/app.css?v=${version}"></head>` +
      `<body><div id="root"></div><script type="module" src="/assets/app.js?v=${version}"></script></body></html>`,
  );
}

export function sendEditorNotFound(res: ServerResponse): void {
  sendHtml(res, 404, publicMessagePage(pageCopy.editorNotFound.heading, pageCopy.editorNotFound.text));
}

export function sendInviteInvalid(res: ServerResponse): void {
  sendHtml(res, 404, publicMessagePage(pageCopy.inviteInvalid.heading, pageCopy.inviteInvalid.text));
}
