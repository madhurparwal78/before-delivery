/**
 * Gotenberg. The app posts its own HTML with the pictures inside the request;
 * Gotenberg never calls the app.
 */
import type { Config } from '../config.ts';

export class RenderUnavailable extends Error {
  constructor(cause?: unknown) {
    super('render service unavailable');
    this.name = 'RenderUnavailable';
    this.cause = cause;
  }
}

export interface RenderAsset {
  name: string;
  bytes: Uint8Array;
  contentType: string;
}

export class Render {
  constructor(private readonly config: Config) {}

  /** The delivered PDF's bytes. */
  async htmlToPdf(html: string, assets: readonly RenderAsset[] = []): Promise<Uint8Array> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    for (const asset of assets) {
      form.append(
        'files',
        new Blob([Buffer.from(asset.bytes)], { type: asset.contentType }),
        asset.name,
      );
    }
    form.append('paperWidth', '8.27');
    form.append('paperHeight', '11.69');
    form.append('marginTop', '0.6');
    form.append('marginBottom', '0.6');
    form.append('marginLeft', '0.6');
    form.append('marginRight', '0.6');
    form.append('printBackground', 'true');

    let res: Response;
    try {
      res = await fetch(`${this.config.gotenbergUrl}/forms/chromium/convert/html`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (cause) {
      throw new RenderUnavailable(cause);
    }
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      throw new RenderUnavailable(`status ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async reachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.gotenbergUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      await res.arrayBuffer().catch(() => undefined);
      return res.ok;
    } catch {
      return false;
    }
  }
}
