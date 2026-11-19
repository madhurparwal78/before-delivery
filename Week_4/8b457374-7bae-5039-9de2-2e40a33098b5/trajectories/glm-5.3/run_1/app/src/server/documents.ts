import type { Config } from "./config.js";

// Statements and settlement sheets are rendered from the app's own HTML by
// Gotenberg and the returned PDF bytes are stored in MinIO by the caller.

export class DocumentsClient {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.gotenbergUrl}/health`, {
        method: "GET",
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Renders an HTML document to PDF bytes. Returns null when unreachable. */
  async renderPdf(html: string): Promise<Buffer | null> {
    const form = new FormData();
    form.append(
      "files",
      new Blob([html], { type: "text/html" }),
      "index.html",
    );
    try {
      const response = await fetch(`${this.config.gotenbergUrl}/forms/chromium/convert/html`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 4 || bytes.subarray(0, 4).toString() !== "%PDF") return null;
      return bytes;
    } catch {
      return null;
    }
  }
}
