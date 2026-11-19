import { briefHtml } from "./brief-html.js";
import type { EnquiryRecord } from "./database.js";

export class BriefService {
  constructor(private gotenbergUrl: string) {}

  async render(enquiry: EnquiryRecord): Promise<Uint8Array> {
    const html = briefHtml(enquiry);
    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${this.gotenbergUrl}/forms/chromium/convert/html`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Gotenberg answered ${response.status}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength === 0) {
        throw new Error("Gotenberg returned an empty PDF");
      }
      return buffer;
    } finally {
      clearTimeout(timer);
    }
  }
}
