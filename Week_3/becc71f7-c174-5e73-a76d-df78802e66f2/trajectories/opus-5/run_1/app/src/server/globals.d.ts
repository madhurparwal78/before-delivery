/**
 * The WebAssembly globals and the ImageData shape the photo codecs take. Node provides
 * both at runtime; neither is in the ES2023 library.
 */

declare namespace WebAssembly {
  class Module {}
  function compile(bytes: ArrayBuffer | Uint8Array): Promise<Module>;
}

interface ImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
