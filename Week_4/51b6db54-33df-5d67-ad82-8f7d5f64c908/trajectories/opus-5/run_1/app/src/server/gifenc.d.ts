declare module 'gifenc' {
  export interface GifFrameOptions {
    palette: number[][];
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    dispose?: number;
    first?: boolean;
    repeat?: number;
  }

  export interface GifWriter {
    writeFrame(
      indices: Uint8Array,
      width: number,
      height: number,
      options: GifFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifWriter;

  const gifenc: {
    GIFEncoder: (options?: { auto?: boolean; initialCapacity?: number }) => GifWriter;
  };
  export default gifenc;
}
