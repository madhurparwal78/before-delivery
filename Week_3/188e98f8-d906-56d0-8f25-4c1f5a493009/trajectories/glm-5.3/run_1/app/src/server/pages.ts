import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Request, Response } from "express";
import { loadSession, type ServerDeps, type RequestWithSession, type SessionContext } from "./routes";
import { deskPathFor } from "./sessions";

const ASSETS = join(dirname(__filename), "..", "..", "public");

interface PageName {
  readonly title: string;
  readonly bodyId: string;
}

function pageFor(path: string): PageName {
  switch (path) {
    case "/":
      return { title: "Public table", bodyId: "page-table" };
    case "/sign-in":
      return { title: "Sign in", bodyId: "page-sign-in" };
    case "/captain":
      return { title: "Answer desk", bodyId: "page-captain" };
    case "/marker":
      return { title: "Marking", bodyId: "page-marker" };
    case "/quizmaster":
      return { title: "Quizmaster's desk", bodyId: "page-quizmaster" };
    case "/archive":
      return { title: "Answer archive", bodyId: "page-archive" };
    default:
      return { title: "Not found", bodyId: "page-not-found" };
  }
}

function shell(title: string, bodyId: string, bodyClass: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Roundkeeper</title>
<link rel="stylesheet" href="/assets/main.css">
</head>
<body id="${bodyId}" class="${bodyClass}">
<header class="banner" role="banner">
  <span class="masthead-name">Roundkeeper</span>
  <span class="masthead-sub">Snug Thursday League · Night 4</span>
</header>
<nav aria-label="Rounds tonight">
<ul id="round-strip" class="round-strip" role="list" aria-label="Rounds tonight"></ul>
</nav>
<main id="app-root"></main>
<div id="modal-root"></div>
<script src="/assets/app.js"></script>
</body>
</html>`;
}

export async function servePage(deps: ServerDeps, path: string, response: Response, request: RequestWithSession): Promise<void> {
  const session = await loadSession(deps, request).catch(() => undefined);
  const signedOutPaths = new Set(["/captain", "/marker", "/quizmaster", "/archive"]);
  if (session === undefined && signedOutPaths.has(path)) {
    response.writeHead(302, { Location: "/sign-in", "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (session !== undefined) {
    const desk = deskPathFor(session.role);
    const archiveAllowed = session.role === "quizmaster" || session.role === "marker";
    if (path === "/sign-in" || (path !== "/" && path !== desk && !(path === "/archive" && archiveAllowed))) {
      response.writeHead(302, { Location: desk, "Cache-Control": "no-store" });
      response.end();
      return;
    }
  }
  const known = path === "/" || path === "/sign-in" || path === "/captain" || path === "/marker" || path === "/quizmaster" || path === "/archive";
  const page = pageFor(path);
  const bodyClass = session === undefined ? "signed-out" : `signed-in-${session.role}`;
  const html = shell(page.title, page.bodyId, bodyClass);
  const status = known ? 200 : 404;
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(html);
}

export function registerPages(app: import("express").Express, deps: ServerDeps): void {
  const page = (path: string) => (request: Request, response: Response) => {
    void servePage(deps, path, response, request as RequestWithSession);
  };
  app.get("/", page("/"));
  app.get("/sign-in", page("/sign-in"));
  app.get("/captain", page("/captain"));
  app.get("/marker", page("/marker"));
  app.get("/quizmaster", page("/quizmaster"));
  app.get("/archive", page("/archive"));
  app.get("/assets/main.css", serveCssAsset);
  app.get("/assets/app.js", serveJsAsset);
}

async function serveCssAsset(_request: Request, response: Response): Promise<void> {
  const bytes = await readAsset("assets/main.css");
  response.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" });
  response.end(bytes);
}

async function serveJsAsset(_request: Request, response: Response): Promise<void> {
  const bytes = await readAsset("assets/app.js");
  response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" });
  response.end(bytes);
}

export async function readAsset(name: string): Promise<Buffer> {
  return readFile(join(ASSETS, name));
}

export { type SessionContext };
