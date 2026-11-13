// The rig sheet press (Gotenberg): renders index.html to a PDF (DP-43).

const PRESS_LIMIT_MS = 20000;

export interface PressResult {
  pdf: Buffer;
}

export async function renderPdf(gotenbergUrl: string, html: string): Promise<PressResult | null> {
  const form = new FormData();
  form.append('index.html', new Blob([html], { type: 'text/html' }), 'index.html');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRESS_LIMIT_MS);
  try {
    const response = await fetch(`${gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('pdf')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return null;
    return { pdf: bytes };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
