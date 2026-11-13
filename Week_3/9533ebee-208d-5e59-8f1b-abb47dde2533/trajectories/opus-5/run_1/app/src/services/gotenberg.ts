/**
 * Statement PDFs, rendered from the statement's HTML by Gotenberg. While it
 * is unreachable renders stay queued and settlements still commit.
 */

import { config } from '../config.ts';

export class RendererUnreachable extends Error {
  constructor(cause: string) {
    super(`The PDF renderer is unreachable: ${cause}`);
    this.name = 'RendererUnreachable';
  }
}

const REQUEST_TIMEOUT_MS = 20000;

/** Renders an HTML document to PDF bytes. */
export async function renderPdf(html: string): Promise<Uint8Array> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RendererUnreachable(error instanceof Error ? error.message : 'unknown');
  }
  if (!response.ok) {
    throw new RendererUnreachable(`render answered ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
