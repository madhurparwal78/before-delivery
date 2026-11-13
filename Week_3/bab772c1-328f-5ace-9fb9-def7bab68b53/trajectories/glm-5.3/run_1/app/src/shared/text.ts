// Text-field character rule and trim/NFC handling, shared by server and browser.

export const CONTROL_CHARACTERS_MESSAGE = "Remove control characters and line or paragraph separators.";

export function hasForbiddenControl(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

export function normaliseText(value: string): string {
  return value.trim().normalize("NFC");
}

export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

// Unicode canonical caseless matching with full case folding (D145, statuses C and F).
// The input is NFC-normalised before folding and the fold is applied twice.
export function canonicalCaselessKey(value: string): string {
  return value
    .normalize("NFD")
    .toLowerCase()
    .normalize("NFD")
    .toLowerCase()
    .normalize("NFC");
}
