import { config } from "./config.js";

const HEALTH_TIMEOUT_MS = 3000;
const RENDER_TIMEOUT_MS = 60_000;

export class PrintingUnavailable extends Error {
  constructor(cause: unknown) {
    super("Printing is unreachable.", { cause });
  }
}

export class PrintingFailed extends Error {}

export interface PaperSize {
  widthInches: string;
  heightInches: string;
}

export async function printingIsUp(): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", config.gotenbergUrl), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Renders one self-contained HTML page to PDF through Gotenberg's Chromium conversion. */
export async function renderPdf(html: string, footerHtml: string, paper: PaperSize, margins: { top: string; bottom: string; side: string }): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("files", new Blob([footerHtml], { type: "text/html" }), "footer.html");
  form.append("paperWidth", paper.widthInches);
  form.append("paperHeight", paper.heightInches);
  form.append("marginTop", margins.top);
  form.append("marginBottom", margins.bottom);
  form.append("marginLeft", margins.side);
  form.append("marginRight", margins.side);
  form.append("printBackground", "true");
  let response: Response;
  try {
    response = await fetch(new URL("/forms/chromium/convert/html", config.gotenbergUrl), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
  } catch (error) {
    throw new PrintingUnavailable(error);
  }
  if (!response.ok) throw new PrintingFailed(`printing answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
