import { config, LIMITS } from "./config";
import { RendererUnavailable } from "./errors";

/** Renders one HTML document to a PDF; anything but a 2xx answer carrying PDF bytes is a failure. */
export async function renderPdf(html: string, files: { name: string; data: Buffer }[]): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  for (const file of files) form.append("files", new Blob([Uint8Array.from(file.data)]), file.name);
  for (const [key, value] of Object.entries({
    paperWidth: "8.5",
    paperHeight: "11",
    marginTop: "0",
    marginBottom: "0",
    marginLeft: "0",
    marginRight: "0",
    printBackground: "true",
    preferCssPageSize: "true",
  })) {
    form.append(key, value);
  }
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(LIMITS.renderSeconds * 1000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new RendererUnavailable();
    return bytes;
  } catch {
    throw new RendererUnavailable();
  }
}

/** The page count read from the PDF itself. */
export function pdfPageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
}
