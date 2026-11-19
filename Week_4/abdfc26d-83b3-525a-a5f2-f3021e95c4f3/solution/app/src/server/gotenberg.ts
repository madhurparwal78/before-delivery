import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

/** Renders an HTML document to PDF through Gotenberg's Chromium route. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("printBackground", "true");
  form.append("preferCssPageSize", "true");
  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ProviderDown("gotenberg", error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) throw new ProviderDown("gotenberg", `HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function reachable(): Promise<boolean> {
  try {
    await fetch(`${config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}
