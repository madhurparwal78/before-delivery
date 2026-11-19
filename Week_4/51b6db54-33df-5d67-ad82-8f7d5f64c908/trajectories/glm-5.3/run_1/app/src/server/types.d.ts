declare module 'pngjs' {
  export class PNG {
    static readonly sync: {
      read(buffer: Buffer | Uint8Array): PNG;
      write(png: PNG, options?: { colorType?: number }): Buffer;
    };
    width: number;
    height: number;
    data: Buffer;
    constructor(options: { width: number; height: number });
    on(event: string, cb: (data: Buffer) => void): PNG;
    parse(buffer: Buffer, cb: (err: Error | null, data: PNG) => void): PNG;
    pack(): PNG;
  }
}

declare module 'omggif' {
  export default class GifReader {
    constructor(buffer: Uint8Array);
    width: number;
    height: number;
    numFrames(): number;
    frameInfo(i: number): { x: number; y: number; width: number; height: number; delay: number; disposal_type: number };
    decodeAndBlitFrameRGBA(i: number, buffer: Uint8Array): void;
  }
  export class GifWriter {
    constructor(buffer: number[] | Uint8Array, width: number, height: number, opts: { loop?: number | null });
    addFrame(x: number, y: number, w: number, h: number, indexedPixels: Uint8Array, opts: {
      palette?: number[];
      delay?: number;
      transparent?: { index: number };
      dispose?: number;
    }): void;
    end(): number;
    bytesView(): Uint8Array;
  }
}
