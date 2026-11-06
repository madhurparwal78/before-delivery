import { config } from "../config.js";
import { ApiError } from "../errors.js";

export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("paperWidth", "8.27");
  form.append("paperHeight", "11.7");
  form.append("marginTop", "0.5");
  form.append("marginBottom", "0.5");
  form.append("marginLeft", "0.6");
  form.append("marginRight", "0.6");
  form.append("printBackground", "true");
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`renderer answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw new ApiError("renderer_unavailable");
  }
}

export async function rendererStatus(): Promise<"ok" | "unavailable"> {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}
