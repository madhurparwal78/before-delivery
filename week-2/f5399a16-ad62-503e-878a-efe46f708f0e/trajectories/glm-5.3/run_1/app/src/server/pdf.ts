// Gotenberg renders the boards PDF and the fee letter PDF: HTML is sent as
// index.html with styles inline and drawings as data addresses, never an
// address for it to fetch.

import type { Config } from "./config";

export class PdfUnavailable extends Error {}

export async function renderPdf(config: Config, html: string): Promise<Buffer> {
  const form = new FormData();
  form.append("index.html", new Blob([html], { type: "text/html" }), "index.html");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new PdfUnavailable();
    return Buffer.from(await res.arrayBuffer());
  } catch {
    throw new PdfUnavailable();
  } finally {
    clearTimeout(timer);
  }
}
