import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isScenarioId } from "../shared/scenarios.js";
import { decodeSegment, interviewSlugOf, interviewTitle } from "../shared/titles.js";
import type { Config } from "./config.js";
import type { ContentStore } from "./database.js";
import { gotenbergAnswers, printHtml } from "./gotenberg.js";
import {
  INVALID, NOT_FOUND, NO_INTERVIEW, NO_SCENARIO, SERVER_ERROR, SHEET_UNAVAILABLE, TOO_LARGE, UNAVAILABLE, readBody, sendBytes, sendJson,
} from "./http.js";
import { pageNameOf, shell, titleOfPage } from "./pages.js";
import { parseRecord } from "./shape.js";
import { sheetHtml } from "./sheet.js";
import type { Asset } from "./statics.js";

interface Services {
  config: Config;
  contentStore: ContentStore;
  assets: Map<string, Asset>;
  /** The compiled browser modules, preloaded by every page so they load in parallel. */
  modules: string[];
}

const SHEET_FILENAME = "vireo-pace-product-sheet.pdf";

type Handler = (request: IncomingMessage, response: ServerResponse, services: Services, match: RegExpExecArray) => Promise<void>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function gradingKeyMatches(request: IncomingMessage, expected: string | undefined): boolean {
  const sent = request.headers["x-grading-key"];
  return expected !== undefined && typeof sent === "string" && timingSafeEqual(digest(sent), digest(expected));
}

/** The first captured segment of a route pattern, decoded. */
function segmentOf(match: RegExpExecArray): string {
  return decodeSegment(match[1]);
}

const health: Handler = async (_request, response, { config, contentStore }) => {
  if (!contentStore.isReady) return sendJson(response, 503, { status: "unavailable" });
  await contentStore.ping();
  const printing = await gotenbergAnswers(config.gotenbergUrl);
  sendJson(response, 200, { status: printing ? "ok" : "unavailable" });
};

const content: Handler = async (_request, response, { contentStore }) => {
  sendJson(response, 200, await contentStore.content());
};

const interview: Handler = async (_request, response, { contentStore }, match) => {
  const detail = await contentStore.interviewDetail(segmentOf(match));
  if (detail) sendJson(response, 200, detail);
  else sendJson(response, 404, NO_INTERVIEW);
};

const scenario: Handler = async (_request, response, { contentStore }, match) => {
  const id = segmentOf(match);
  const found = isScenarioId(id) ? await contentStore.scenario(id) : null;
  if (found) sendJson(response, 200, found);
  else sendJson(response, 404, NO_SCENARIO);
};

const sheet: Handler = async (_request, response, { config, contentStore }) => {
  const { edition, product } = await contentStore.product();
  let pdf: Buffer;
  try {
    pdf = await printHtml(config.gotenbergUrl, sheetHtml(product, edition));
  } catch {
    return sendJson(response, 503, SHEET_UNAVAILABLE);
  }
  sendBytes(response, 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${SHEET_FILENAME}"`,
    "Cache-Control": "no-store",
  }, pdf);
};

/** The grading routes: the key is checked first, then the size, then the shape. */
const replaceContent: Handler = async (request, response, { config, contentStore }) => {
  if (!gradingKeyMatches(request, config.gradingKey)) {
    request.resume();
    return sendJson(response, 404, NOT_FOUND);
  }
  const body = await readBody(request);
  if (body === null) return sendJson(response, 413, TOO_LARGE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return sendJson(response, 422, INVALID);
  }
  const record = parseRecord(parsed);
  if (!record) return sendJson(response, 422, INVALID);
  sendJson(response, 200, { edition: await contentStore.replace(record) });
};

const restoreContent: Handler = async (request, response, { config, contentStore }) => {
  request.resume();
  if (!gradingKeyMatches(request, config.gradingKey)) return sendJson(response, 404, NOT_FOUND);
  sendJson(response, 200, { edition: await contentStore.restore() });
};

const API_ROUTES: { method: string; path: RegExp; run: Handler }[] = [
  { method: "GET", path: /^\/api\/health$/, run: health },
  { method: "GET", path: /^\/api\/content$/, run: content },
  { method: "GET", path: /^\/api\/interviews\/([^/]+)$/, run: interview },
  { method: "GET", path: /^\/api\/scenarios\/([^/]+)$/, run: scenario },
  { method: "GET", path: /^\/api\/product\/sheet$/, run: sheet },
  { method: "PUT", path: /^\/api\/grading\/content$/, run: replaceContent },
  { method: "DELETE", path: /^\/api\/grading\/content$/, run: restoreContent },
];

/** A static file, or the shell with the title and status of the page the address names. */
async function page(request: IncomingMessage, response: ServerResponse, { contentStore, assets, modules }: Services, pathname: string): Promise<void> {
  request.resume();
  const asset = assets.get(pathname);
  if (asset) {
    if (request.headers["if-none-match"] === asset.etag) {
      return sendBytes(response, 304, { ETag: asset.etag, "Cache-Control": "no-cache" }, Buffer.alloc(0));
    }
    return sendBytes(response, 200, { "Content-Type": asset.type, ETag: asset.etag, "Cache-Control": "no-cache" }, asset.body);
  }
  const [status, title] = await pageHead(contentStore, pathname);
  sendBytes(response, status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }, Buffer.from(shell(title, modules)));
}

/** The status and document title of the page an address names: an unknown address or interview is a 404. */
async function pageHead(contentStore: ContentStore, pathname: string): Promise<[number, string]> {
  const slug = interviewSlugOf(pathname);
  if (slug !== null) {
    const found = await contentStore.interviewDetail(slug);
    return found ? [200, interviewTitle(found.name)] : [404, titleOfPage(null)];
  }
  const name = pageNameOf(pathname);
  return [name === null ? 404 : 200, titleOfPage(name)];
}

export async function handle(request: IncomingMessage, response: ServerResponse, services: Services): Promise<void> {
  try {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      for (const route of API_ROUTES) {
        const match = route.path.exec(pathname);
        if (match && route.method === request.method) return await route.run(request, response, services, match);
      }
      request.resume();
      return sendJson(response, 404, NOT_FOUND);
    }
    if (request.method !== "GET") {
      request.resume();
      return sendJson(response, 404, NOT_FOUND);
    }
    await page(request, response, services, pathname);
  } catch (error) {
    console.error("request failed:", error);
    if (response.headersSent) return;
    const ready = services.contentStore.isReady;
    sendJson(response, ready ? 500 : 503, ready ? SERVER_ERROR : UNAVAILABLE);
  }
}
