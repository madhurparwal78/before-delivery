/** Gotenberg: the dossier PDF, A4 portrait, with the app's own fonts. */

import { readFile } from "node:fs/promises";
import { config } from "../config.js";
import { DependencyDown } from "../errors.js";
import { publicFilePath } from "../assets.js";

const RENDER_TIMEOUT_MS = 10_000;

const FONT_FILES = [
  "archivo-latin-400-normal.woff2",
  "archivo-latin-600-normal.woff2",
  "ibm-plex-sans-latin-400-normal.woff2",
  "ibm-plex-sans-latin-600-normal.woff2",
  "ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono-latin-500-normal.woff2",
];

export async function probeRenderer(): Promise<boolean> {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function renderDossier(html: string, title: string): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  for (const file of FONT_FILES) {
    const bytes = await readFile(publicFilePath(`fonts/${file}`));
    form.append("files", new Blob([bytes], { type: "font/woff2" }), file);
  }
  form.append("paperWidth", "8.27");
  form.append("paperHeight", "11.7");
  form.append("marginTop", "0.6");
  form.append("marginBottom", "0.6");
  form.append("marginLeft", "0.6");
  form.append("marginRight", "0.6");
  form.append("printBackground", "true");
  form.append("metadata", JSON.stringify({ Title: title }));

  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new DependencyDown("renderer", String(error));
  }
}
