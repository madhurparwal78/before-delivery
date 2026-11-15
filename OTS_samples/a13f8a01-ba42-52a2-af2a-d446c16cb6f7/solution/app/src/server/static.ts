import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { Reply } from "./context.js";

const CLIENT_DIRECTORY = path.resolve(import.meta.dirname, "../client");
const PUBLIC_URL_ATTRIBUTE = config.publicUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const SHELL = Buffer.from(
  readFileSync(path.join(CLIENT_DIRECTORY, "index.html"), "utf8").replace(
    "<head>",
    `<head><meta name="ashlar-public-url" content="${PUBLIC_URL_ATTRIBUTE}">`,
  ),
);

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

const PAGE_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
];

export function shellReply(status: number, embeddable: boolean): Reply {
  const policy = embeddable ? PAGE_POLICY : [...PAGE_POLICY, "frame-ancestors 'none'"];
  return {
    status,
    raw: SHELL,
    type: "text/html; charset=utf-8",
    headers: {
      "Content-Security-Policy": policy.join("; "),
      "Cache-Control": "no-store",
      ...(embeddable ? {} : { "X-Frame-Options": "DENY" }),
    },
  };
}

export function assetReply(pathname: string): Reply | null {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  const file = path.resolve(CLIENT_DIRECTORY, relative);
  const type = TYPES[path.extname(file)];
  if (type === undefined || !file.startsWith(CLIENT_DIRECTORY + path.sep) || relative === "index.html") return null;
  try {
    if (!statSync(file).isFile()) return null;
    return { status: 200, raw: readFileSync(file), type, headers: { "Cache-Control": "public, max-age=31536000, immutable" } };
  } catch {
    return null;
  }
}
