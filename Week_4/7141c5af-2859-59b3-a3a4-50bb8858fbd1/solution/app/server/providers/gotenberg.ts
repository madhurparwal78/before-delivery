import { config } from "../config.ts";
import { ProviderDown } from "./call.ts";

const RENDER_WAIT_MS = 30_000;
const A4 = { paperWidth: "8.27", paperHeight: "11.69" };

/** Posts the app's own HTML, pictures inside it, and answers the PDF's bytes. Gotenberg never calls the app. */
export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  for (const [name, value] of Object.entries(A4)) form.append(name, value);
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form, signal: AbortSignal.timeout(RENDER_WAIT_MS) });
    if (!response.ok) throw new ProviderDown(`renderer answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof ProviderDown) throw error;
    throw new ProviderDown("renderer failed");
  }
}
