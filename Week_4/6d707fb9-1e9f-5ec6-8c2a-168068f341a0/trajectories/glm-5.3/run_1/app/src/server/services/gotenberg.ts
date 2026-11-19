import type { Config } from "../config/env.js";
import { PROVIDER_TIMEOUT_MS } from "../config/env.js";

/**
 * Gotenberg: the app sends the dossier's HTML as index.html with styles and fonts
 * inline, and never asks Gotenberg to fetch an address. The reply body is the PDF.
 */
export async function renderPdf(config: Config, html: string): Promise<Buffer> {
  const form = new FormData();
  form.append(
    "files",
    new Blob([html], { type: "text/html" }),
    "index.html",
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS * 6);
  try {
    const res = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`gotenberg answered ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.subarray(0, 4).toString("latin1") !== "%PDF") {
      throw new Error("gotenberg did not answer a PDF");
    }
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

export function pdfSignature(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).toString("latin1") === "%PDF";
}
