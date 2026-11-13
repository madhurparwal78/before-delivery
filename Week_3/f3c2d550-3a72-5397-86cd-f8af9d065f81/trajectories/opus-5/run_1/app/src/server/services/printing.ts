import type { Paper } from '../../shared/types.js';

/** The printing service, reached with the URL from the environment. */

export class PrintingUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrintingUnreachable';
  }
}

export class PrintingRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrintingRefused';
  }
}

function baseUrl(): string {
  const url = process.env.GOTENBERG_URL;
  if (!url) throw new Error('GOTENBERG_URL is not set');
  return url.replace(/\/+$/, '');
}

const PAPER_SIZES: Record<Paper, { width: string; height: string }> = {
  a4: { width: '210mm', height: '297mm' },
  letter: { width: '8.5in', height: '11in' },
};

export async function reachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${baseUrl()}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Renders one self-contained page to PDF. The service is never asked to fetch a URL: the
 * page and its footer are sent as files.
 */
export async function renderPdf(
  page: string,
  footer: string,
  paper: Paper,
): Promise<Buffer> {
  const size = PAPER_SIZES[paper];
  const form = new FormData();
  form.append('files', new Blob([page], { type: 'text/html' }), 'index.html');
  form.append('files', new Blob([footer], { type: 'text/html' }), 'footer.html');
  form.append('paperWidth', size.width);
  form.append('paperHeight', size.height);
  form.append('marginTop', '12mm');
  form.append('marginBottom', '16mm');
  form.append('marginLeft', '12mm');
  form.append('marginRight', '12mm');
  form.append('printBackground', 'true');
  form.append('preferCssPageSize', 'false');
  form.append('skipNetworkIdleEvent', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    throw new PrintingUnreachable(`printing request failed: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new PrintingRefused(`printing refused the page: ${response.status} ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
