// Gotenberg PDF renderer (DP-36, DP-99). Anything but a 2xx whose body
// starts with %PDF- counts as a failure and stores nothing.
const RENDER_LIMIT_MS = 60_000;

export class RendererUnavailableError extends Error {
  constructor() {
    super("renderer_unavailable");
  }
}

export interface RendererClient {
  renderPdf(html: string): Promise<Uint8Array>;
}

class GotenbergRenderer implements RendererClient {
  constructor(private readonly url: string) {}

  async renderPdf(html: string): Promise<Uint8Array> {
    const form = new FormData();
    form.append("files", new Blob([Buffer.from(html, "utf8")], { type: "text/html" }), "index.html");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RENDER_LIMIT_MS);
    try {
      const response = await fetch(`${this.url.replace(/\/$/, "")}/forms/chromium/convert/html`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw new RendererUnavailableError();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
        throw new RendererUnavailableError();
      }
      return bytes;
    } catch (error) {
      if (error instanceof RendererUnavailableError) throw error;
      throw new RendererUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}

export function makeRenderer(url: string): RendererClient {
  return new GotenbergRenderer(url);
}
