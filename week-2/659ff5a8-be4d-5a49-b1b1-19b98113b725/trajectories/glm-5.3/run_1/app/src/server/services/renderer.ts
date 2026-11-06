// Gotenberg: renders server-built HTML to PDF, and answers health for the
// renderer status on the publish screen.
const STATUS_TIMEOUT_MS = 2000;

export class Renderer {
  private baseUrl: string;

  constructor(gotenbergUrl: string) {
    this.baseUrl = gotenbergUrl.replace(/\/$/, "");
  }

  async renderPdf(html: string): Promise<Buffer> {
    const form = new FormData();
    form.append("index.html", new Blob([html], { type: "text/html" }), "index.html");
    const res = await globalThis.fetch(`${this.baseUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Gotenberg render failed with ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async status(): Promise<"ok" | "unavailable"> {
    try {
      const res = await globalThis.fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      return res.ok ? "ok" : "unavailable";
    } catch {
      return "unavailable";
    }
  }
}
