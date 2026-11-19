import { config } from '../config.js';

const CALL_TIMEOUT_MS = 30_000;

/** Gotenberg could not be reached; the caller keeps its document number and retries. */
export class PdfRenderingUnavailable extends Error {
  constructor(cause: unknown) {
    super('Invoice rendering is down');
    this.name = 'PdfRenderingUnavailable';
    this.cause = cause;
  }
}

/** Posts HTML to Gotenberg and returns the PDF bytes. */
export async function renderPdf(html: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new PdfRenderingUnavailable(`Gotenberg answered ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof PdfRenderingUnavailable) throw error;
    throw new PdfRenderingUnavailable(error);
  } finally {
    clearTimeout(timer);
  }
}

export async function probeGotenberg(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, { signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
