import { Router, type Request, type Response } from "express";
import { q1 } from "../db.js";
import { loadSession } from "../session.js";
import { esc } from "./html.js";
import { err } from "../http.js";
import { asyncHandler } from "../http.js";

export const deskRouter = Router();

const TITLE_SUFFIX = " — Semenza Desk";

const deskShell = (opts: { title: string; heading: string; body: string; mainActionLabel?: string }): string => {
  const { title, heading, body } = opts;
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}${TITLE_SUFFIX}</title>
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body data-desk="true">
<div class="desk-topbar">
  <a class="wordmark" href="/">Semenza Desk</a>
  <nav class="desk-nav" aria-label="Desk">
    <a href="/pieces">Pieces</a><a href="/clients">Clients</a><a href="/library">Library</a><a href="/bench">Bench</a><a href="/workbook">Workbook</a><a href="/rates">Rates</a>
  </nav>
  <div class="desk-tools">
    <form class="desk-search" id="desk-search" role="search">
      <input type="search" id="search-input" name="q" placeholder="Search the desk" aria-label="Search the desk" autocomplete="off">
      <ul id="search-results" role="listbox" aria-label="Search results" hidden></ul>
    </form>
    <button id="change-password">Change password</button>
    <button id="sign-out">Sign out</button>
    <button id="menu-button" aria-expanded="false" aria-controls="menu-sheet">Menu</button>
  </div>
</div>
<p id="refresh-state" role="status" class="refresh-state" aria-live="off"></p>
<p id="announcements" role="status" aria-live="polite" class="announcements"></p>
<nav id="sections-nav" aria-label="Sections" class="sections-rail" hidden></nav>
<main id="main">
  <h1 id="screen-heading">${esc(heading)}</h1>
  <div id="screen-root">
${body}
  </div>
</main>
<div class="bottom-bar" data-bar="main-action" id="bottom-bar"></div>
<div id="menu-sheet" class="sheet" hidden>
  <div class="sheet-panel">
    <nav aria-label="Desk menu">
      <a href="/pieces">Pieces</a><a href="/clients">Clients</a><a href="/library">Library</a><a href="/bench">Bench</a><a href="/workbook">Workbook</a><a href="/rates">Rates</a>
    </nav>
    <button id="menu-change-password">Change password</button>
    <button id="menu-sign-out">Sign out</button>
    <button id="menu-close">Close</button>
  </div>
</div>
<div id="dialog-root"></div>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
};

const signedOutRedirect = (req: Request, res: Response, returnTo: string): void => {
  res.redirect(302, `/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
};

const deskScreen = (screen: string) =>
  asyncHandler(async (req: Request, res: Response) => {
    const session = await loadSession(req);
    if (!session) {
      signedOutRedirect(req, res, req.originalUrl.split("?")[0]!.split("#")[0]!);
      return;
    }
    void q1;
    void err;
    res.send(deskShell({ title: "Pieces", heading: "Pieces", body: `<div data-screen="${esc(screen)}" data-path="${esc(req.path)}" data-query="${esc(req.originalUrl.split("?")[1] ?? "")}"></div>` }));
  });

deskRouter.get("/pieces", deskScreen("pieces"));
deskRouter.get("/pieces/:id", asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req);
  if (!session) { signedOutRedirect(req, res, "/pieces"); return; }
  res.send(deskShell({ title: "Piece", heading: "Piece", body: `<div data-screen="piece" data-piece-id="${esc(req.params.id!)}" data-path="${esc(req.path)}"></div>` }));
}));
deskRouter.get("/pieces/:id/condition", asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req);
  if (!session) { signedOutRedirect(req, res, `/pieces/${req.params.id}/condition`); return; }
  res.send(deskShell({ title: `Condition of Piece`, heading: `Condition of Piece`, body: `<div data-screen="condition" data-piece-id="${esc(req.params.id!)}"></div>` }));
}));
deskRouter.get("/pieces/:id/photographs", asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req);
  if (!session) { signedOutRedirect(req, res, `/pieces/${req.params.id}/photographs`); return; }
  res.send(deskShell({ title: `Photographs of Piece`, heading: `Photographs of Piece`, body: `<div data-screen="photographs" data-piece-id="${esc(req.params.id!)}"></div>` }));
}));
deskRouter.get("/pieces/:id/hide", asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req);
  if (!session) { signedOutRedirect(req, res, `/pieces/${req.params.id}/hide`); return; }
  res.send(deskShell({ title: `Hide for Piece`, heading: `Hide for Piece`, body: `<div data-screen="hide" data-piece-id="${esc(req.params.id!)}"></div>` }));
}));
deskRouter.get("/pieces/:id/estimate", asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req);
  if (!session) { signedOutRedirect(req, res, `/pieces/${req.params.id}/estimate`); return; }
  res.send(deskShell({ title: `Estimate for Piece`, heading: `Estimate for Piece`, body: `<div data-screen="estimate" data-piece-id="${esc(req.params.id!)}"></div>` }));
}));
deskRouter.get("/pieces/:id/collection", asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req);
  if (!session) { signedOutRedirect(req, res, `/pieces/${req.params.id}/collection`); return; }
  res.send(deskShell({ title: `Collection of Piece`, heading: `Collection of Piece`, body: `<div data-screen="collection" data-piece-id="${esc(req.params.id!)}"></div>` }));
}));
deskRouter.get("/pieces/:id/dossier", asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req);
  if (!session) { signedOutRedirect(req, res, `/pieces/${req.params.id}/dossier`); return; }
  res.send(deskShell({ title: `Dossier for Piece`, heading: `Dossier for Piece`, body: `<div data-screen="dossier" data-piece-id="${esc(req.params.id!)}"></div>` }));
}));
deskRouter.get("/clients", deskScreen("clients"));
deskRouter.get("/clients/:id", asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req);
  if (!session) { signedOutRedirect(req, res, `/clients/${req.params.id}`); return; }
  res.send(deskShell({ title: "Client", heading: "Client", body: `<div data-screen="client" data-client-id="${esc(req.params.id!)}"></div>` }));
}));
deskRouter.get("/library", deskScreen("library"));
deskRouter.get("/bench", deskScreen("bench"));
deskRouter.get("/workbook", deskScreen("workbook"));
deskRouter.get("/rates", deskScreen("rates"));

export const deskShellHtml = deskShell;
