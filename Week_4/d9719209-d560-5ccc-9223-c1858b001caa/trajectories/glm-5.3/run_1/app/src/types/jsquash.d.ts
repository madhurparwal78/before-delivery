/* Type declarations for @jsquash/webp subpaths, whose shipped .d.ts files
   reference Emscripten outputs that are not present as TS sources. */
declare module '@jsquash/webp/encode.js' {
  export interface WebpEncodeOptions { quality?: number }
  export function init(module?: WebAssembly.Module): Promise<unknown>;
  export default function encode(data: { data: Uint8Array; width: number; height: number }, options?: WebpEncodeOptions): Promise<ArrayBuffer>;
}

declare module '@jsquash/webp/decode.js' {
  export function init(module?: WebAssembly.Module): Promise<unknown>;
  export default function decode(buffer: ArrayBuffer): Promise<{ data: Uint8Array; width: number; height: number }>;
}

declare const WebAssembly: {
  compile(bytes: ArrayBuffer): Promise<WebAssemblyModule>;
};
type WebAssemblyModule = unknown;
