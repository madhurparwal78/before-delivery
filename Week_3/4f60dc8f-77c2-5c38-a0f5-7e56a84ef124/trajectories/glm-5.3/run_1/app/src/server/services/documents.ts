import type { AppConfig } from '../config';

export class Documents {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(3_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Render an HTML document to PDF through Gotenberg's LibreOffice conversion. */
  async renderPdf(html: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'document.html');
    const response = await fetch(`${this.config.gotenbergUrl}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error('unreachable');
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
