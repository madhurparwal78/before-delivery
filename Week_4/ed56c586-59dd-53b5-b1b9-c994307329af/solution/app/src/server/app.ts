import { type IncomingMessage, type ServerResponse } from "node:http";
import { handleApi, type ApiContext } from "./api.js";
import { METHOD_NOT_ALLOWED, sendError, sendHtml } from "./http.js";
import { renderPage } from "./pages.js";
import { type StaticFile } from "./static-files.js";

/** The request dispatcher: API and media routes, built assets, then pages. Nothing else is ever served. */

export interface AppContext extends ApiContext {
  readonly files: ReadonlyMap<string, StaticFile>;
}

export async function handleRequest(context: AppContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const target = request.url ?? "/";
  const queryAt = target.indexOf("?");
  const pathname = queryAt === -1 ? target : target.slice(0, queryAt);
  const method = request.method ?? "GET";
  if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) {
    await handleApi(context, request, response, pathname);
    return;
  }
  const isRead = method === "GET";
  const file = context.files.get(pathname);
  if (file !== undefined && isRead) {
    response.writeHead(200, { "content-type": file.contentType, "cache-control": file.cacheControl });
    response.end(file.bytes);
    return;
  }
  if (!isRead) {
    sendError(response, 405, METHOD_NOT_ALLOWED);
    return;
  }
  const page = renderPage(pathname, new URLSearchParams(queryAt === -1 ? "" : target.slice(queryAt + 1)));
  sendHtml(response, page.status, page.html);
}
