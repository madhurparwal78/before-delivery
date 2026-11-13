import type { Config } from '../config.js';

export class PdfRenderer {
  constructor(private cfg: Config) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(this.cfg.gotenbergUrl, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async renderHtml(html: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    const res = await fetch(`${this.cfg.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`gotenberg failed ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
