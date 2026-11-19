import { config } from '../config.js';
import { markService, ServiceDownError } from './health.js';

const CALL_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;

function down(detail: string): ServiceDownError {
  markService('documents', 'down');
  return new ServiceDownError('documents', `Gotenberg unreachable: ${detail}`);
}

/** Renders a PDF from the app's own HTML by posting an index.html file. */
export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('index.html', new Blob([html], { type: 'text/html' }), 'index.html');
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.arrayBuffer();
      throw down(`status ${response.status}`);
    }
    markService('documents', 'up');
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof ServiceDownError) throw error;
    throw down(error instanceof Error ? error.message : 'network error');
  }
}

export async function probeDocuments(): Promise<void> {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    markService('documents', response.ok ? 'up' : 'down');
  } catch {
    markService('documents', 'down');
  }
}
