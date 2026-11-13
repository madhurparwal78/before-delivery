export type KitCodeProblem = 'shape' | 'check';

export interface KitCodeResult {
  kitCode?: string;
  problem?: KitCodeProblem;
}

/** ISO 7064 MOD 11-2 over the seven digits; 10 is written `X`. */
export function kitCodeCheckCharacter(digits: string): string {
  let remainder = 0;
  for (const digit of digits) {
    remainder = ((remainder + Number(digit)) * 2) % 11;
  }
  const check = (12 - remainder) % 11;
  return check === 10 ? 'X' : String(check);
}

/** Reads a kit code in any letter case, with or without dashes and spaces. */
export function readKitCode(input: string): KitCodeResult {
  const bare = input.replace(/[-\s]/g, '').toUpperCase();
  const match = /^KT(\d{7})([0-9X])$/.exec(bare);
  if (!match) return { problem: 'shape' };
  const digits = match[1] as string;
  const check = match[2] as string;
  if (kitCodeCheckCharacter(digits) !== check) return { problem: 'check' };
  return { kitCode: `KT-${digits}-${check}` };
}
