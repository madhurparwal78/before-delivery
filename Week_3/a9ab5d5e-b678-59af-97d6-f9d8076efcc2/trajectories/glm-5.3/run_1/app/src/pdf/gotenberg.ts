/** Gotenberg Chromium HTML to PDF client: one multipart post, PDF back. */
export class RendererUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RendererUnavailable';
  }
}

export async function renderPdf(gotenbergUrl: string, indexHtml: string): Promise<Buffer> {
  const boundary = `twohouse-${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="index.html"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n`,
    'utf8',
  );
  parts.push(fileHeader, Buffer.from(indexHtml, 'utf8'), Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  const body = Buffer.concat(parts);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${gotenbergUrl.replace(/\/$/, '')}/forms/chromium/convert/html`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`renderer ${res.status}`);
    const pdf = Buffer.from(await res.arrayBuffer());
    if (pdf.length < 4 || pdf.subarray(0, 5).toString('utf8') !== '%PDF-') {
      throw new Error('renderer sent no PDF');
    }
    return pdf;
  } catch (e) {
    throw new RendererUnavailable(`unreachable: ${(e as Error).message}`);
  }
}
