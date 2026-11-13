// Gotenberg dossier rendering. The HTML refers only to files sent in the same
// request; the app bundles the dossier fonts with it.

import { DependencyError, fetchWithTimeout, requireEnv } from "./deps.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RENDER_TIMEOUT_MS = 10000;

const fontFiles: Record<string, Buffer> = {};
{
  for (const name of ["Archivo.ttf", "IBMPlexSans.ttf", "IBMPlexMono-Regular.ttf"]) {
    try {
      const path = fileURLToPath(new URL(`../../public/fonts/${name}`, import.meta.url));
      fontFiles[name] = readFileSync(path);
    } catch {
      // Fonts are optional for rendering; the stylesheet degrades gracefully.
    }
  }
}

export async function renderDossierPdf(html: string): Promise<Buffer> {
  const url = `${requireEnv("GOTENBERG_URL").replace(/\/$/, "")}/forms/chromium/convert/html`;
  const form = new FormData();
  form.append(
    "index.html",
    new Blob([html], { type: "text/html" }),
    "index.html",
  );
  for (const [name, bytes] of Object.entries(fontFiles)) {
    form.append(name, new Blob([new Uint8Array(bytes)]), name);
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(url, { method: "POST", body: form }, RENDER_TIMEOUT_MS);
  } catch {
    throw new DependencyError("renderer");
  }
  if (!response.ok) {
    throw new DependencyError("renderer");
  }
  const body = await response.arrayBuffer().catch(() => null);
  if (!body) throw new DependencyError("renderer");
  return Buffer.from(body);
}

export async function probeRenderer(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${requireEnv("GOTENBERG_URL").replace(/\/$/, "")}/health`,
      { method: "GET" },
      1000,
    );
    return response.ok;
  } catch {
    return false;
  }
}
