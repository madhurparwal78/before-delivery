export interface PageViewport {
  width: number;
  height: number;
}

export interface PdfPage {
  getViewport(options: { scale: number }): PageViewport;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PageViewport }): {
    promise: Promise<void>;
  };
}

export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

export interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(source: { data: ArrayBuffer }): { promise: Promise<PdfDocument> };
}

const MODULE_URL = '/assets/pdf.mjs';
const WORKER_URL = '/assets/pdf.worker.mjs';

let loading: Promise<PdfjsModule> | null = null;

/**
 * The page renderer is served by this app from its own origin. This is the one
 * boundary where that module takes the shape used here.
 */
export const pdfjs = async (): Promise<PdfjsModule> => {
  if (loading === null) {
    loading = import(MODULE_URL).then((loaded: unknown) => {
      const module = loaded as PdfjsModule;
      module.GlobalWorkerOptions.workerSrc = WORKER_URL;
      return module;
    });
  }
  return loading;
};
