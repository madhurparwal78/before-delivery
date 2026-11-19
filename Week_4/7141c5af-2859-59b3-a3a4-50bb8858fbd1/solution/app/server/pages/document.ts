import { latinFonts } from "../http/assets.ts";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}

interface DocumentParts {
  title: string;
  body: string;
  script: "public" | "desk" | "client";
  lang?: string;
  dir?: "ltr" | "rtl";
  /** The polite region's accessible name: `Announcements`, or C24 on the client page. */
  announcements?: string;
  /** JSON handed to the page's script. */
  boot?: unknown;
  /** Preload Jost's latin files: pages whose first paint is Latin text. */
  fonts?: boolean;
}

/** The one document shell. The Announcements region is in it, so it is there from first paint and outside whatever goes inert. */
export function document(parts: DocumentParts): string {
  const boot = parts.boot === undefined ? "" : `<script type="application/json" id="boot">${JSON.stringify(parts.boot).replace(/</g, "\\u003c")}</script>`;
  const fonts = parts.fonts ? latinFonts().map((name) => `<link rel="preload" href="/assets/${name}" as="font" type="font/woff2" crossorigin>\n`).join("") : "";
  return `<!doctype html>
<html lang="${parts.lang ?? "en"}" dir="${parts.dir ?? "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(parts.title)}</title>
${fonts}<link rel="stylesheet" href="/assets/base.css">
<script type="module" src="/assets/${parts.script}.js"></script>
</head>
<body>
${parts.body}
<div id="overlays"></div>
<div id="announcements" role="status" aria-live="polite" aria-label="${escapeHtml(parts.announcements ?? "Announcements")}"></div>
${boot}
</body>
</html>`;
}
