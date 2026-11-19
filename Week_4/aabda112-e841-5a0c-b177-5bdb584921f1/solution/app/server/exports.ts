import { now } from './clock.js';
import { AppError } from './errors.js';
import type { Ctx } from './http.js';
import { renderPdf, type PdfContent } from './pdf.js';
import { putObject, StorageUnavailable } from './storage.js';

/** Renders a PDF, puts it to MinIO, and answers with the very bytes that were stored. */
export async function exportPdf(ctx: Ctx, clinicId: string, name: string, content: PdfContent): Promise<void> {
  const bytes = await renderPdf(content);
  const key = `clinics/${clinicId}/exports/${name}-${Math.floor(now().getTime() / 1000)}.pdf`;
  try {
    await putObject(key, bytes);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new AppError('storage_unavailable');
    throw error;
  }
  ctx.res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': bytes.length,
    'Content-Disposition': `inline; filename="${name}.pdf"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  ctx.res.end(bytes);
}
