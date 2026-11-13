import { config } from '../config';

export class RendererUnavailable extends Error {}

const RENDER_TIMEOUT_MS = 30_000;

/** One HTML file through Gotenberg's Chromium HTML route. */
export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl.replace(/\/+$/, '')}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
  } catch {
    throw new RendererUnavailable('renderer unreachable');
  }
  if (!response.ok) throw new RendererUnavailable(`renderer answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
