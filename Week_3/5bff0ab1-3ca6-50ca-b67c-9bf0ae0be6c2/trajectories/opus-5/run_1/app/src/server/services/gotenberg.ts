const TIMEOUT_MS = 15_000;

export class SheetFailed extends Error {
  constructor() {
    super('price sheet render failed');
    this.name = 'SheetFailed';
  }
}

function looksLikePdf(bytes: Buffer): boolean {
  if (bytes.length < 8) return false;
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return false;
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1');
  return tail.includes('%%EOF');
}

/** A sheet is only ready when a complete PDF came back. */
export async function renderPdf(html: string): Promise<Buffer> {
  const base = process.env.GOTENBERG_URL;
  if (!base) throw new SheetFailed();
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  let response: Response;
  try {
    response = await fetch(`${base}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SheetFailed();
  }
  if (response.status !== 200) throw new SheetFailed();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!looksLikePdf(bytes)) throw new SheetFailed();
  return bytes;
}
