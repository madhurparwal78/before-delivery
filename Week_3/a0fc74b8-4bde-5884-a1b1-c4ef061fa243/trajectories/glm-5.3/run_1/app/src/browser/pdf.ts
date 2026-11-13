import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface RenderedPage { canvas: HTMLCanvasElement; width: number; height: number }

const pageCache = new Map<string, { width: number; height: number }>();

export async function renderPage(
  pdfBytes: ArrayBuffer,
  pageNumber: number,
  targetWidth: number,
): Promise<HTMLCanvasElement> {
  const doc = await getDocument({ data: pdfBytes.slice(0) }).promise;
  const page = await doc.getPage(pageNumber);
  const viewportBase = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewportBase.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  const context = canvas.getContext("2d");
  if (context !== null) {
    await page.render({ canvas, canvasContext: context, viewport }).promise;
  }
  return canvas;
}

export async function pdfPageCount(pdfBytes: ArrayBuffer): Promise<number> {
  const doc = await getDocument({ data: pdfBytes.slice(0) }).promise;
  const count = doc.numPages;
  pageCache.set(keyFor(pdfBytes), { width: 0, height: 0 });
  return count;
}

function keyFor(_bytes: ArrayBuffer): string {
  return "last";
}

export async function measurePages(pdfBytes: ArrayBuffer): Promise<{ width: number; height: number }[]> {
  const doc = await getDocument({ data: pdfBytes.slice(0) }).promise;
  const sizes: { width: number; height: number }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
  }
  return sizes;
}
