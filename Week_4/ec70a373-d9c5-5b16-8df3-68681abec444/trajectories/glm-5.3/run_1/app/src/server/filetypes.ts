/** Type detection from leading bytes, agreeing with the declared part type. */
export const ACCEPTED_TYPES: Record<string, Uint8Array[]> = {
  'application/pdf': [Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])],
  'image/png': [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/jpeg': [Uint8Array.from([0xff, 0xd8, 0xff])],
};

export function detectedType(declared: string | null, bytes: Buffer): string | null {
  if (declared === null) return null;
  const signatures = ACCEPTED_TYPES[declared];
  if (!signatures) return null;
  for (const signature of signatures) {
    if (bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(Buffer.from(signature))) {
      return declared;
    }
  }
  return null;
}

export function isAcceptedType(declared: string | null): boolean {
  return declared !== null && declared in ACCEPTED_TYPES;
}
