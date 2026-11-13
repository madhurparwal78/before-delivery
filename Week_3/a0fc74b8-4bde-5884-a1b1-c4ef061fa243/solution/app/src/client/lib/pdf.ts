import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { track } from "./quiet";

// Pages are drawn at the width the sheet is shown at (in device pixels), rounded up to a step so a small resize
// reuses the drawing it has, and never past MAX_WIDTH.
const STEP = 200;
const MIN_WIDTH = 400;
const MAX_WIDTH = 2400;

export function renderWidth(cssWidth: number): number {
  const wanted = Math.ceil((cssWidth * (window.devicePixelRatio || 1)) / STEP) * STEP;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, wanted));
}

export class PdfSource {
  private readonly images = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly document: PDFDocumentProxy) {}

  image(pageNumber: number, width: number): Promise<string> {
    const key = `${pageNumber}@${width}`;
    const cached = this.images.get(key);
    if (cached) return cached;
    const made = this.queue.then(() => this.draw(pageNumber, width));
    this.queue = made.catch(() => undefined);
    this.images.set(key, made);
    return made;
  }

  private async draw(pageNumber: number, width: number): Promise<string> {
    const page = await this.document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("page image could not be made");
    return URL.createObjectURL(blob);
  }

  destroy(): void {
    for (const pending of this.images.values()) void pending.then((url) => URL.revokeObjectURL(url), () => undefined);
    void this.document.destroy();
  }
}

export type PdfState = { status: "loading" } | { status: "ready"; source: PdfSource } | { status: "unavailable" };

export function usePdf(url: string): PdfState {
  const [state, setState] = useState<PdfState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    let made: PdfSource | null = null;
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await track(fetch(url));
        if (!response.ok) throw new Error(`PDF answered ${response.status}`);
        const data = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const document = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
        made = new PdfSource(document);
        if (cancelled) made.destroy();
        else setState({ status: "ready", source: made });
      } catch {
        if (!cancelled) setState({ status: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
      made?.destroy();
    };
  }, [url]);
  return state;
}
