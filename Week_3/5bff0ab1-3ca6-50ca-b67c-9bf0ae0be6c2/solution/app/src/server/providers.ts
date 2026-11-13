import { config } from "./config.js";
import { fail } from "./errors.js";

/** The two outside providers, reached only through their published interfaces. */

const PDF_HEAD = "%PDF-";

/** A complete PDF starts with the header and carries an end marker in its last 1024 bytes. */
const isCompletePdf = (bytes: Buffer): boolean =>
  bytes.subarray(0, PDF_HEAD.length).toString("latin1") === PDF_HEAD && bytes.subarray(Math.max(0, bytes.length - 1024)).toString("latin1").includes("%%EOF");

export async function renderPdf(html: string): Promise<Buffer> {
  try {
    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    const reply = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form, signal: AbortSignal.timeout(15_000) });
    if (reply.status !== 200) throw new Error(`gotenberg answered ${reply.status}`);
    const bytes = Buffer.from(await reply.arrayBuffer());
    if (!isCompletePdf(bytes)) throw new Error("gotenberg did not return a complete PDF");
    return bytes;
  } catch {
    throw fail("sheet_unreachable");
  }
}

/** Publishes a phone notice; it counts as accepted only on a 200 reply within 3 seconds. */
export async function publishNotice(topic: string, title: string, message: string): Promise<boolean> {
  try {
    const auth = Buffer.from(`${config.ntfyUsername}:${config.ntfyPassword}`).toString("base64");
    const reply = await fetch(`${config.ntfyUrl}/${topic}`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, Title: title },
      body: message,
      signal: AbortSignal.timeout(3000),
    });
    await reply.arrayBuffer();
    return reply.status === 200;
  } catch {
    return false;
  }
}

export const topicOf = (riderId: string): string => `malhar-${riderId}`;
