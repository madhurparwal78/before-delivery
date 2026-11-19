import { gunzipSync, gzipSync } from "fflate";
import type { GzipOptions } from "fflate";
import { crc32Value } from "./checksums";
import { OperationError } from "./types";

export function gzip(input: Uint8Array, level: number): Uint8Array {
  return gzipSync(input, { level: level as GzipOptions["level"], mtime: 0 });
}

/** The trailer's CRC-32 and length (mod 2^32) must match what was inflated. */
function trailerMatches(input: Uint8Array, output: Uint8Array): boolean {
  const trailer = new DataView(input.buffer, input.byteOffset + input.length - 8, 8);
  return trailer.getUint32(0, true) === crc32Value(output) && trailer.getUint32(4, true) === output.length >>> 0;
}

export function gunzip(input: Uint8Array): Uint8Array {
  if (input[0] !== 0x1f || input[1] !== 0x8b) throw new OperationError("Not gzip data");
  let output: Uint8Array;
  try {
    output = gunzipSync(input);
  } catch {
    throw new OperationError("Gzip data is damaged");
  }
  if (input.length < 18 || !trailerMatches(input, output)) throw new OperationError("Gzip data is damaged");
  return output;
}
