import { config } from "./config.js";

/** Gotenberg renders HTML to a real PDF with a text layer. */

export class PdfUnreachable extends Error {
  constructor() {
    super("pdf unreachable");
  }
}

export const renderPdf = async (html: string): Promise<Buffer> => {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("preferCssPageSize", "true");
  form.append("printBackground", "true");
  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST", body: form, signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new PdfUnreachable();
  }
  if (!response.ok) throw new PdfUnreachable();
  return Buffer.from(await response.arrayBuffer());
};
