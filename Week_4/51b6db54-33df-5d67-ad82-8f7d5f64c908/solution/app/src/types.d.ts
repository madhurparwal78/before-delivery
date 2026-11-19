declare module 'omggif' {
  export interface GifFrameInfo {
    x: number;
    y: number;
    width: number;
    height: number;
    delay: number;
    disposal: number;
    transparent_index: number | null;
  }
  export class GifWriter {
    constructor(buffer: Uint8Array, width: number, height: number, options?: { loop?: number });
    addFrame(
      x: number,
      y: number,
      width: number,
      height: number,
      indexed: Uint8Array,
      options?: { palette?: number[]; delay?: number; disposal?: number; transparent?: number | null },
    ): number;
    end(): number;
  }
  export class GifReader {
    constructor(buffer: Uint8Array);
    width: number;
    height: number;
    numFrames(): number;
    frameInfo(index: number): GifFrameInfo;
    decodeAndBlitFrameRGBA(index: number, pixels: Uint8Array): void;
  }
}

declare module '*.css';
