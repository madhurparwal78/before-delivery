declare module 'pngjs' {
  export class PNG {
    constructor(options: { width: number; height: number; colorType?: number; inputHasAlpha?: boolean });
    width: number;
    height: number;
    data: Uint8Array;
    static sync: {
      write(png: PNG): Buffer;
      read(buffer: Buffer): PNG;
    };
  }
}
