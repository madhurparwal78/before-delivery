import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config";
import { documentFor } from "./document";
import { answerApi, errorAnswer, methodNotAllowed, sendDocument } from "./http";
import { prepareDatabase } from "./seed";
import { startWorker } from "./worker";
import "./routes/desk";
import "./routes/labels";
import "./routes/styles";
import "./routes/requests";
import "./routes/visits";
import "./routes/results";
import "./routes/passports";
import "./routes/dossiers";

const ASSETS = fileURLToPath(new URL("./assets/", import.meta.url));
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

async function serveAsset(response: ServerResponse, path: string, head: boolean): Promise<boolean> {
  const relative = normalize(path.slice("/assets/".length));
  if (relative.startsWith("..")) return false;
  try {
    const bytes = await readFile(ASSETS + relative);
    sendDocument(response, { status: 200, bytes, headers: { "Content-Type": TYPES[extname(relative)] ?? "application/octet-stream", "Cache-Control": "no-cache" } }, head);
    return true;
  } catch {
    return false;
  }
}

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", config.publicUrl);
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) return answerApi(request, response, url);
  request.resume();
  const head = request.method === "HEAD";
  if (request.method !== "GET" && !head) {
    sendDocument(response, errorAnswer(methodNotAllowed("GET")), false);
    return;
  }
  if (path.startsWith("/assets/") && (await serveAsset(response, path, head))) return;
  sendDocument(response, await documentFor(request, url), head);
}

async function main(): Promise<void> {
  const server = createServer((request, response) => {
    answer(request, response).catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  server.listen(config.port, "0.0.0.0");
  await prepareDatabase();
  startWorker();
}

void main();
