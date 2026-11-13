/**
 * Kit codes: KT-, seven digits, - and an ISO 7064 MOD 11-2 check character.
 * Input is accepted in any letter case, with or without dashes and spaces.
 * Stored and shown in upper-case dashed form.
 */
export type KitCodeCheck = { valid: false; reason: "shape" | "check" } | { valid: true; normalized: string };

export function normalizeKitCodeInput(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** Compute the ISO 7064 MOD 11-2 check character for seven digits. */
export function kitCodeCheckCharacter(sevenDigits: string): string {
  let remainder = 0;
  for (const ch of sevenDigits) {
    const digit = Number(ch);
    remainder = (remainder + digit) % 11;
    remainder = (remainder * 2) % 11;
  }
  const checkValue = ((12 - remainder) % 11) % 11;
  return checkValue === 10 ? "X" : checkValue.toString();
}

export function checkKitCode(raw: string): KitCodeCheck {
  const compact = normalizeKitCodeInput(raw);
  const match = /^KT(\d{7})(\d|X)$/.exec(compact);
  if (!match) return { valid: false, reason: "shape" };
  const digits = match[1] ?? "";
  const given = match[2] ?? "";
  if (kitCodeCheckCharacter(digits) !== given) return { valid: false, reason: "check" };
  return { valid: true, normalized: `KT-${digits}-${given}` };
}
