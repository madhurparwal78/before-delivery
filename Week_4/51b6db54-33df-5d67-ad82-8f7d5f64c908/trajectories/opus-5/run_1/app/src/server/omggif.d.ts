declare module 'omggif' {
  export class GifReader {
    constructor(bytes: Uint8Array);
    width: number;
    height: number;
    numFrames(): number;
    frameInfo(index: number): { delay: number; disposal: number };
    decodeAndBlitFrameRGBA(index: number, pixels: Uint8Array): void;
  }
}
