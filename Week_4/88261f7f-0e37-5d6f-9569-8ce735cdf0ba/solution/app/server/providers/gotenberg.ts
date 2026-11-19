import { config, PROVIDER_TIMEOUT_MS } from "../config";

/** The PDF service cannot be reached or refused the render. */
export class PdfUnavailable extends Error {}

const RENDER_TIMEOUT_MS = 30_000;

export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  try {
    const answer = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST", body: form, signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
    if (!answer.ok) throw new PdfUnavailable();
    return Buffer.from(await answer.arrayBuffer());
  } catch {
    throw new PdfUnavailable();
  }
}

export async function pdfServiceReachable(): Promise<boolean> {
  try {
    return (await fetch(`${config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })).ok;
  } catch {
    return false;
  }
}
