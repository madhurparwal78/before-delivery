// Gotenberg renders the condition report and the handover record from HTML this app writes.

import { config } from '../config.js';

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '8.27');
  form.append('paperHeight', '11.7');
  form.append('marginTop', '0.6');
  form.append('marginBottom', '0.6');
  form.append('marginLeft', '0.5');
  form.append('marginRight', '0.5');
  form.append('printBackground', 'true');
  let reply: Response;
  try {
    reply = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) {
    throw new RenderError(`the renderer did not answer: ${(error as Error).message}`);
  }
  if (!reply.ok) {
    await reply.text().catch(() => undefined);
    throw new RenderError(`the renderer refused the document: ${reply.status}`);
  }
  const body = Buffer.from(await reply.arrayBuffer());
  if (body.subarray(0, 4).toString('latin1') !== '%PDF') throw new RenderError('the renderer did not return a PDF');
  return body;
}

export async function rendererReachable(): Promise<boolean> {
  try {
    const reply = await fetch(`${config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(5000) });
    await reply.text().catch(() => undefined);
    return reply.ok;
  } catch {
    return false;
  }
}
