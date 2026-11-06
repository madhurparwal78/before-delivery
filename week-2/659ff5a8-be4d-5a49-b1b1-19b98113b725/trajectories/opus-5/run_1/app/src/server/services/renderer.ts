import { config } from '../config';

const RENDER_TIMEOUT_MS = 20_000;
const HEALTH_TIMEOUT_MS = 2_000;

export class RendererUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RendererUnavailable';
  }
}

export async function rendererStatus(): Promise<'ok' | 'unavailable'> {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Renders server-built HTML to PDF bytes. */
export async function renderPdf(document: {
  html: string;
  headerHtml?: string;
}): Promise<Buffer> {
  const form = new FormData();
  form.set('index.html', new Blob([document.html], { type: 'text/html' }), 'index.html');
  if (document.headerHtml) {
    form.set('header.html', new Blob([document.headerHtml], { type: 'text/html' }), 'header.html');
    form.set('marginTop', '0.8');
  }
  form.set('marginBottom', '0.4');
  form.set('marginLeft', '0.4');
  form.set('marginRight', '0.4');
  form.set('printBackground', 'true');

  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RendererUnavailable(`PDF renderer is unreachable: ${String(error)}`);
  }
  if (!response.ok) {
    throw new RendererUnavailable(`PDF renderer answered ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
