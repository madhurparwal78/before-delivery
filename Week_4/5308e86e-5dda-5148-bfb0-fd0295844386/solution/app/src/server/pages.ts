/** HTML pages, static assets and the tour captions. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { cockpitDocument, cockpitPageFor } from "./pages/cockpit.js";
import { loginPage, signupPage } from "./pages/auth.js";
import type { RenderedPage } from "./pages/layout.js";
import { marketingPages, notFoundPage, tourCaptions } from "./pages/marketing/index.js";
import { readAsset } from "./static.js";

const ASSET_PREFIX = "/assets/";
const TOUR_CAPTIONS_PATH = "/media/tour.vtt";

function sendHtml(res: ServerResponse, status: number, page: RenderedPage, head: boolean): void {
  const body = Buffer.from(page.html);
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": page.private ? "no-store" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(head ? undefined : body);
}

function sendFile(res: ServerResponse, body: Buffer, contentType: string, cacheControl: string, head: boolean): void {
  res.writeHead(200, { "Content-Type": contentType, "Content-Length": body.length, "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" });
  res.end(head ? undefined : body);
}

export async function handlePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const head = method === "HEAD";
  if (method !== "GET" && !head) {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Length": 0 }).end();
    return;
  }
  const path = url.pathname;
  if (path.startsWith(ASSET_PREFIX)) {
    const asset = await readAsset(path);
    if (asset) sendFile(res, asset.body, asset.contentType, asset.cacheControl, head);
    else sendHtml(res, 404, notFoundPage(), head);
    return;
  }
  if (path === TOUR_CAPTIONS_PATH) {
    sendFile(res, Buffer.from(tourCaptions), "text/vtt; charset=utf-8", "no-cache", head);
    return;
  }
  const marketing = marketingPages[path];
  if (marketing) {
    sendHtml(res, 200, marketing(), head);
    return;
  }
  if (path === "/login") {
    sendHtml(res, 200, loginPage(), head);
    return;
  }
  if (path === "/signup") {
    sendHtml(res, 200, signupPage(), head);
    return;
  }
  const cockpit = cockpitPageFor(path);
  if (cockpit) {
    sendHtml(res, 200, cockpitDocument(cockpit), head);
    return;
  }
  sendHtml(res, 404, notFoundPage(), head);
}
