export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

const HEX_DIGITS = /[0-9a-fA-F]/;

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const hi = clean[i]!;
    const lo = clean[i + 1]!;
    if (!HEX_DIGITS.test(hi) || !HEX_DIGITS.test(lo)) return new Uint8Array(0);
    out[i / 2] = Number.parseInt(hi + lo, 16);
  }
  return out;
}
