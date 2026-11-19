import { readdir, readFile } from "node:fs/promises";
import { config } from "./config.ts";
import type { DisplayConfig } from "../shared/api.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

interface Asset {
  body: Buffer;
  type: string;
}

const assets = new Map<string, Asset>();
let shell = "";

/** Reads the built client once. The browser receives the bundle and the display settings, nothing else of the configuration. */
export async function loadClientAssets(): Promise<void> {
  const root = new URL("./public/", import.meta.url);
  const display: DisplayConfig = { squareRowRevealMs: config.squareRowRevealMs, timeZone: config.timeZone };
  for (const name of await readdir(root)) {
    const extension = name.slice(name.lastIndexOf("."));
    let body = await readFile(new URL(name, root));
    if (name === "index.html") {
      const injected = `<script id="display-config" type="application/json">${JSON.stringify(display)}</script>`;
      shell = body.toString("utf8").replace("<!--display-config-->", injected);
      continue;
    }
    assets.set(`/${name}`, { body, type: CONTENT_TYPES[extension] ?? "application/octet-stream" });
  }
}

/**
 * The app shell. For a member of the workspace in the route it names that workspace, so the browser opens the live
 * channel before the bundle renders; anyone else never tries the upgrade.
 */
export function appShell(liveWorkspaceId?: string): string {
  const hint = liveWorkspaceId ? `<meta name="live-workspace" content="${liveWorkspaceId}" />` : "";
  return shell.replace("<!--live-workspace-->", hint);
}

/** A built file, or undefined: the shell is served by `appShell` for any route without a file extension. */
export function clientAsset(path: string): Asset | undefined {
  return assets.get(path);
}
