// Gotenberg renders the contract and invoice HTML to PDF.
import { config } from "../config.js";
import { expectOk, reach } from "./reach.js";

export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("printBackground", "true");
  const response = await reach("gotenberg", `${config.gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form }, 60_000);
  await expectOk("gotenberg", response, 200);
  return Buffer.from(await response.arrayBuffer());
}
