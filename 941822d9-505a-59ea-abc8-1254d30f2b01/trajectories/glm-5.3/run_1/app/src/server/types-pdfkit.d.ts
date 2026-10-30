declare module "pdfkit" {
  interface PDFKitOptions {
    size?: string;
    margin?: number;
    layout?: string;
  }
  class PDFDocument {
    constructor(options?: PDFKitOptions);
    on(event: "data" | "end" | "error", cb: (chunk: Buffer) => void): this;
    font(name: string): this;
    fontSize(n: number): this;
    fillColor(c: string): this;
    text(t: string, opts?: { align?: string; width?: number }): this;
    moveDown(n?: number): this;
    moveUp(n?: number): this;
    end(): this;
    x: number;
    y: number;
    readonly page: { width: number; height: number };
  }
  export = PDFDocument;
}
