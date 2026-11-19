import { latin1String } from "../../shared/bytes";

const EXAMINED_BYTES = 4096;
const HEX_PAIRS = /^[0-9a-fA-F]{2}(?:[ ,:\n]?[0-9a-fA-F]{2}){3,}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The operation the Input pane suggests for these bytes, by the published detection rules in their order. */
export function suggestOperation(input: Uint8Array): string | null {
  const head = input.subarray(0, EXAMINED_BYTES);
  if (head[0] === 0x1f && head[1] === 0x8b) return "Gunzip";
  const text = latin1String(head);
  if (HEX_PAIRS.test(text)) return "From Hex";
  if (text.length >= 8 && text.length % 4 === 0 && BASE64.test(text)) return "From Base64";
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      JSON.parse(text);
      return "JSON Beautify";
    } catch {
      // Not JSON; the later rules still apply.
    }
  }
  return /%[0-9a-fA-F]{2}/.test(text) ? "URL Decode" : null;
}
