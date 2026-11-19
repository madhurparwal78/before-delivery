import { config } from "../config.js";

/** Post HTML to Gotenberg with the pictures inline; returns the PDF bytes. */
export async function renderPdf(html: string): Promise<Buffer | null> {
  const form = new FormData();
  form.append("index.html", new Blob([html], { type: "text/html" }), "index.html");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form, signal: controller.signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
