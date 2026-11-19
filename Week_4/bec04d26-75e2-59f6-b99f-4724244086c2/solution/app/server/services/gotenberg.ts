import { config } from "../config";

const RENDER_TIMEOUT_MS = 60000;
const PROBE_TIMEOUT_MS = 1500;

export interface HtmlFile { name: string; data: Buffer }

/** Renders HTML (with the files it references) to PDF bytes. Throws unless Gotenberg answers with a PDF. */
export async function renderPdf(html: string, files: HtmlFile[]): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  for (const file of files) form.append("files", new Blob([new Uint8Array(file.data)]), file.name);
  form.append("paperWidth", "8.5");
  form.append("paperHeight", "11");
  form.append("printBackground", "true");
  form.append("preferCssPageSize", "true");
  const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
    method: "POST", body: form, signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`gotenberg answered ${response.status}`);
  const pdf = Buffer.from(await response.arrayBuffer());
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("gotenberg returned no PDF");
  return pdf;
}

export async function gotenbergAnswers(): Promise<boolean> {
  try {
    return (await fetch(`${config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })).ok;
  } catch {
    return false;
  }
}
