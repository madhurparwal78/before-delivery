// The kit code rule, ISO 7064 MOD 11-2, in one place.

const SHAPE = /^KT(\d{7})([0-9X])$/;

function squeezed(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

function checkCharacter(digits: string): string {
  let sum = 0;
  for (const digit of digits) sum = ((sum + Number(digit)) * 2) % 11;
  const check = (12 - sum) % 11;
  return check === 10 ? "X" : String(check);
}

export function normalizeKitCode(input: string): string {
  const value = squeezed(input);
  return `KT-${value.slice(2, 9)}-${value.slice(9)}`;
}

// The refusal copy for an input, or null for a valid kit code.
export function kitCodeRefusal(input: string): string | null {
  const match = SHAPE.exec(squeezed(input));
  if (!match) return "Enter a kit code like KT-1000042-7.";
  if (checkCharacter(match[1] ?? "") !== match[2]) return "That kit code isn't valid. Check the last character.";
  return null;
}
