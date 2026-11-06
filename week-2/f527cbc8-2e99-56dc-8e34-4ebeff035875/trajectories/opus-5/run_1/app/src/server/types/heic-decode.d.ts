declare module 'heic-decode' {
  interface DecodeInput {
    buffer: Uint8Array;
  }
  interface DecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  export default function decode(input: DecodeInput): Promise<DecodedImage>;
}
