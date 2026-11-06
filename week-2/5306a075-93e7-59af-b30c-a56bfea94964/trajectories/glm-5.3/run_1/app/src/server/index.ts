import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { applyMigrations } from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { ApiError, errors } from "./errors.js";
import { dispatchApi, INSTANCE_ID, type Route } from "./router.js";
import { initStorage, startWorkers } from "./services.js";
import { sessionRoutes } from "./handlers/session.js";
import { notesRoutes } from "./handlers/notes.js";
import { noteActionRoutes } from "./handlers/attachments.js";
import { insightRoutes } from "./handlers/insights.js";
import { featureRoutes } from "./handlers/features.js";
import { objectiveRoutes } from "./handlers/objectives.js";
import { roadmapRoutes } from "./handlers/roadmap.js";
import { shipRoutes } from "./handlers/ship.js";
import { shareRoutes, activeWorkspaceForToken, publicColumns } from "./handlers/share.js";
import { companyRoutes } from "./handlers/companies.js";
import { searchRoutes } from "./handlers/search.js";
import { importRoutes } from "./handlers/imports.js";
import { exportRoutes } from "./handlers/export.js";

const thisDir = dirname(fileURLToPath(import.meta.url));
const clientDir = join(thisDir, "..", "client");

const routes: Route[] = [
  ...sessionRoutes,
  ...notesRoutes,
  ...noteActionRoutes,
  ...insightRoutes,
  ...featureRoutes,
  ...objectiveRoutes,
  ...roadmapRoutes,
  ...shipRoutes,
  ...shareRoutes,
  ...companyRoutes,
  ...searchRoutes,
  ...importRoutes,
  ...exportRoutes,
];

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const PUBLIC_ROADMAP_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

function findIndexHtml(): { html: string } | null {
  const path = join(clientDir, "index.html");
  if (!existsSync(path)) return null;
  return { html: readFileSync(path, "utf-8") };
}

async function statFile(path: string): Promise<{ isFile: boolean } | null> {
  try {
    const s = await stat(path);
    return { isFile: s.isFile() };
  } catch {
    return null;
  }
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

/** Paths that must never be served (DP-38). */
/** The app's own routes; everything else is 404 (DP-38). */
function isAppRoute(path: string): boolean {
  const appRoutes = [
    "/",
    "/signin",
    "/inbox",
    "/features",
    "/roadmap",
    "/companies",
    "/import",
    "/settings",
  ];
  if (appRoutes.includes(path)) return true;
  if (path.startsWith("/inbox/")) return true;
  if (path.startsWith("/features/")) return true;
  if (path.startsWith("/companies/")) return true;
  if (path.startsWith("/invite/")) return true;
  return false;
}

const escapeHtmlText = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function publicRoadmapHtml(
  token: string,
  columns: Array<{ month: string; label: string; releases: Array<{ name: string; targetMonth: string; features: Array<{ name: string; publicDescription: string }> }> }>,
  workspaceName: string,
): string {
  const sections = columns
    .map((column) => {
      const releases = column.releases
        .map((release) => {
          const features = release.features
            .map(
              (f) =>
                `<li><strong>${escapeHtmlText(f.name)}</strong>${f.publicDescription.length > 0 ? `<p class="public-description">${escapeHtmlText(f.publicDescription)}</p>` : ""}</li>`,
            )
            .join("");
          return `<li><h3>${escapeHtmlText(release.name)}</h3><ul class="public-features">${features}</ul></li>`;
        })
        .join("");
      return `<section class="public-month" aria-labelledby="month-${escapeHtmlText(column.month)}"><h2 id="month-${escapeHtmlText(column.month)}">${escapeHtmlText(column.label)}</h2><ul class="public-releases">${releases}</ul></section>`;
    })
    .join("");
  const ornament = `<svg class="ornament" viewBox="0 0 120 24" width="120" height="24" aria-hidden="true" focusable="false"><path d="M2 12h30M88 12h30" stroke="#1c2840" stroke-width="1"/><circle cx="60" cy="12" r="5" fill="none" stroke="#2547d0" stroke-width="1.5"/><circle cx="60" cy="12" r="2" fill="#ffd54a"/></svg>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Product roadmap — ${escapeHtmlText(workspaceName)}</title>
<link rel="stylesheet" href="/assets/public.css">
</head>
<body class="public-page">
<main class="public-sheet">
${ornament}
<h1>Product roadmap</h1>
${sections}
</main>
</body></html>`;
}

function publicInactiveHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Product roadmap</title>
<link rel="stylesheet" href="/assets/public.css">
</head>
<body class="public-page">
<main class="public-sheet">
<svg class="ornament" viewBox="0 0 120 24" width="120" height="24" aria-hidden="true" focusable="false"><path d="M2 12h30M88 12h30" stroke="#1c2840" stroke-width="1"/><circle cx="60" cy="12" r="5" fill="none" stroke="#8b909c" stroke-width="1.5"/></svg>
<h1>This roadmap link is no longer active</h1>
<p class="public-description">Ask the team that sent it to you for a new link.</p>
</main>
</body></html>`;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  initStorage(config);

  // Wait for PostgreSQL, retrying every 2 seconds (DP-38).
  let ready = false;
  while (!ready) {
    try {
      await pool.query("SELECT 1");
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await applyMigrations(pool);
  await seedIfEmpty(pool);
  startWorkers(pool, config);

  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url ?? "/";
      const path = url.split("?")[0]!;

      if (path.startsWith("/api/")) {
        let outcome;
        try {
          outcome = await dispatchApi(req, res, url, config, pool, routes);
        } catch (err) {
          const apiError =
            err instanceof ApiError ? err : errors.internal();
          if (!(err instanceof ApiError)) {
            console.error("unhandled error", err);
          }
          if (path.startsWith("/api/public/")) {
            sendRaw(res, apiError.status, JSON.stringify(apiError.body()), {
              "Content-Type": "application/json; charset=utf-8",
              ...PUBLIC_ROADMAP_HEADERS,
            });
          } else {
            sendRaw(res, apiError.status, JSON.stringify(apiError.body()), {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            });
          }
          return;
        }
        if (outcome === undefined) return;
        const headers = outcome.headers;
        if (outcome.body instanceof Buffer) {
          sendRaw(res, outcome.status, "", headers, outcome.body);
          return;
        }
        if (typeof outcome.body === "string") {
          sendRaw(res, outcome.status, outcome.body, headers);
          return;
        }
        if (outcome.body === undefined) {
          sendRaw(res, outcome.status, "", headers);
          return;
        }
        sendRaw(res, outcome.status, JSON.stringify(outcome.body), headers);
        return;
      }

      // The public roadmap page (no sign-in).
      if (path.startsWith("/r/")) {
        const token = path.slice(3);
        const workspace = token.length > 0 ? await activeWorkspaceForToken(pool, token) : null;
        if (workspace === null) {
          sendHtml(res, 404, publicInactiveHtml(), PUBLIC_ROADMAP_HEADERS);
          return;
        }
        const client = await pool.connect();
        try {
          const columns = await publicColumns(client, workspace.id);
          sendHtml(res, 200, publicRoadmapHtml(token, columns, workspace.name), PUBLIC_ROADMAP_HEADERS);
        } finally {
          client.release();
        }
        return;
      }

      // Built client assets and public files.
      const assetPath = join(clientDir, path.replace(/^\//, ""));
      if (
        assetPath.startsWith(clientDir) &&
        existsSync(assetPath) &&
        !assetPath.endsWith(".ts") &&
        !assetPath.endsWith(".tsx") &&
        !assetPath.endsWith(".map") &&
        !assetPath.endsWith(".sql")
      ) {
        const stat = await statFile(assetPath);
        if (stat !== null && stat.isFile) {
          const bytes = readFileSync(assetPath);
          res.writeHead(200, {
            "Content-Type": contentTypeFor(path),
            "Cache-Control": "public, max-age=3600",
          });
          res.end(bytes);
          return;
        }
      }

      // The single-page app routes.
      if (isAppRoute(path)) {
        const index = findIndexHtml();
        if (index !== null) {
          sendHtml(res, 200, index.html, { "Content-Security-Policy": CSP });
          return;
        }
      }
      sendRaw(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    } catch (err) {
      console.error("request failed", err);
      if (!res.headersSent) {
        sendRaw(res, 500, JSON.stringify(errors.internal().body()), {
          "Content-Type": "application/json; charset=utf-8",
        });
      } else {
        res.end();
      }
    }
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`Evidence Desk listening on port ${config.port} (instance ${INSTANCE_ID})`);
  });
}

function sendRaw(
  res: http.ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string | string[]>,
  rawBytes?: Buffer,
): void {
  res.writeHead(status, headers);
  if (rawBytes !== undefined) {
    res.end(rawBytes);
    return;
  }
  res.end(body);
}

function sendHtml(
  res: http.ServerResponse,
  status: number,
  html: string,
  extra: Record<string, string>,
): void {
  sendRaw(res, status, html, {
    "Content-Type": "text/html; charset=utf-8",
    ...extra,
  });
}

main().catch((err) => {
  console.error("server failed to start", err);
  process.exit(1);
});
